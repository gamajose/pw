using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using static PwNative.Win32;

namespace PwNative;

/// <summary>
/// Operações de leitura/escrita de memória (offsets do jogo), alinhamento de câmera e métricas de processo.
/// </summary>
internal static class MemoryOps
{
    private static readonly Dictionary<uint, (DateTime time, TimeSpan cpu)> CpuSamples = new();

    /// <summary>Abre o processo para leitura de memória.</summary>
    public static IntPtr OpenForRead(uint pid)
    {
        var h = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, pid);
        if (h == IntPtr.Zero) h = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        return h;
    }

    /// <summary>Abre o processo para leitura e escrita de memória.</summary>
    public static IntPtr OpenForWrite(uint pid)
    {
        var h = OpenProcess(PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_VM_OPERATION | PROCESS_QUERY_INFORMATION, false, pid);
        if (h == IntPtr.Zero) h = OpenProcess(PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_VM_OPERATION, false, pid);
        return h;
    }

    [DllImport("kernel32.dll", SetLastError = true, CallingConvention = CallingConvention.Winapi)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWow64Process([In] IntPtr hProcess, [Out] out bool wow64Process);

    public static bool Is32Bit(IntPtr hProc)
    {
        if (Environment.Is64BitOperatingSystem)
        {
            if (IsWow64Process(hProc, out bool isWow64)) return isWow64;
        }
        return IntPtr.Size == 4;
    }

    public static IntPtr GetModuleBase(uint pid, string? moduleName = null)
    {
        try
        {
            using var proc = Process.GetProcessById((int)pid);
            if (string.IsNullOrEmpty(moduleName)) return proc.MainModule?.BaseAddress ?? IntPtr.Zero;
            foreach (ProcessModule m in proc.Modules)
            {
                if (string.Equals(m.ModuleName, moduleName, StringComparison.OrdinalIgnoreCase))
                    return m.BaseAddress;
            }
            return proc.MainModule?.BaseAddress ?? IntPtr.Zero;
        }
        catch
        {
            return IntPtr.Zero;
        }
    }

    public static byte[]? ReadBytes(IntPtr hProc, IntPtr address, int size)
    {
        if (address == IntPtr.Zero || size <= 0) return null;
        var buffer = new byte[size];
        if (ReadProcessMemory(hProc, address, buffer, size, out var read) && read.ToInt64() == size)
            return buffer;
        return null;
    }

    public static bool WriteBytes(IntPtr hProc, IntPtr address, byte[] data)
    {
        if (address == IntPtr.Zero || data == null || data.Length == 0) return false;
        return WriteProcessMemory(hProc, address, data, data.Length, out var written) && written.ToInt64() == data.Length;
    }

    public static IntPtr ResolvePointerChain(IntPtr hProc, IntPtr baseAddress, int[] offsets)
    {
        if (hProc == IntPtr.Zero || baseAddress == IntPtr.Zero) return IntPtr.Zero;
        bool is32 = Is32Bit(hProc);
        int ptrSize = is32 ? 4 : 8;

        IntPtr current = baseAddress;
        for (int i = 0; i < offsets.Length; i++)
        {
            var targetAddr = IntPtr.Add(current, offsets[i]);
            if (i == offsets.Length - 1)
            {
                // Último offset: retorna o endereço final
                return targetAddr;
            }

            var ptrBytes = ReadBytes(hProc, targetAddr, ptrSize);
            if (ptrBytes == null) return IntPtr.Zero;

            long nextVal = is32 ? BitConverter.ToUInt32(ptrBytes, 0) : BitConverter.ToInt64(ptrBytes, 0);
            if (nextVal == 0) return IntPtr.Zero;
            current = (IntPtr)nextVal;
        }

        return current;
    }

    public static int? ReadInt32(IntPtr hProc, IntPtr address)
    {
        var b = ReadBytes(hProc, address, 4);
        return b != null ? BitConverter.ToInt32(b, 0) : null;
    }

    public static float? ReadFloat(IntPtr hProc, IntPtr address)
    {
        var b = ReadBytes(hProc, address, 4);
        return b != null ? BitConverter.ToSingle(b, 0) : null;
    }

    public static bool WriteFloat(IntPtr hProc, IntPtr address, float val)
    {
        return WriteBytes(hProc, address, BitConverter.GetBytes(val));
    }

    /// <summary>
    /// Lê estatísticas de jogo (HP, MP, coords, câmera) com base na configuração de offsets.
    /// </summary>
    public static JsonObject ReadStats(uint pid, JsonObject config)
    {
        var result = new JsonObject { ["pid"] = pid, ["ok"] = false };
        var hProc = OpenForRead(pid);
        if (hProc == IntPtr.Zero) return result;

        try
        {
            string? moduleName = config["module"]?.GetValue<string>();
            var modBase = GetModuleBase(pid, moduleName);
            if (modBase == IntPtr.Zero) return result;

            long baseRva = 0;
            if (config.TryGetPropertyValue("base", out var bNode) && bNode != null)
            {
                baseRva = ParseHexOrLong(bNode.GetValue<string>());
            }
            else if (config.TryGetPropertyValue("gameRva", out var gNode) && gNode != null)
            {
                baseRva = ParseHexOrLong(gNode.GetValue<string>());
            }

            var rootPtr = IntPtr.Add(modBase, (int)baseRva);
            var values = new JsonObject();

            if (config["attributes"] is JsonObject attrs)
            {
                foreach (var (key, val) in attrs)
                {
                    if (val is JsonObject attrObj)
                    {
                        var chain = ParseOffsetChain(attrObj["chain"]);
                        var type = attrObj["type"]?.GetValue<string>() ?? "int";
                        var finalAddr = ResolvePointerChain(hProc, rootPtr, chain);
                        if (finalAddr != IntPtr.Zero)
                        {
                            if (type == "float")
                            {
                                var f = ReadFloat(hProc, finalAddr);
                                if (f.HasValue) values[key] = f.Value;
                            }
                            else
                            {
                                var n = ReadInt32(hProc, finalAddr);
                                if (n.HasValue) values[key] = n.Value;
                            }
                        }
                    }
                }
            }

            result["ok"] = true;
            result["values"] = values;
            return result;
        }
        catch (Exception ex)
        {
            result["error"] = ex.Message;
            return result;
        }
        finally
        {
            CloseHandle(hProc);
        }
    }

    /// <summary>
    /// Sincroniza a câmera (yaw, pitch, zoom) do líder com os clientes seguidores.
    /// </summary>
    public static JsonObject AlignCamera(uint leaderPid, uint[] followerPids, JsonObject cameraConfig)
    {
        var result = new JsonObject { ["leaderPid"] = leaderPid, ["alignedCount"] = 0, ["ok"] = false };
        if (leaderPid == 0 || followerPids == null || followerPids.Length == 0) return result;

        var hLeader = OpenForRead(leaderPid);
        if (hLeader == IntPtr.Zero) return result;

        try
        {
            string? moduleName = cameraConfig["module"]?.GetValue<string>();
            var leaderMod = GetModuleBase(leaderPid, moduleName);
            long baseRva = ParseHexOrLong(cameraConfig["base"]?.GetValue<string>() ?? "0");
            var leaderRoot = IntPtr.Add(leaderMod, (int)baseRva);

            int[] yawChain = ParseOffsetChain(cameraConfig["yawChain"]);
            int[] pitchChain = ParseOffsetChain(cameraConfig["pitchChain"]);
            int[] zoomChain = ParseOffsetChain(cameraConfig["zoomChain"]);

            var leaderYawAddr = ResolvePointerChain(hLeader, leaderRoot, yawChain);
            var leaderPitchAddr = ResolvePointerChain(hLeader, leaderRoot, pitchChain);
            var leaderZoomAddr = ResolvePointerChain(hLeader, leaderRoot, zoomChain);

            float? yaw = leaderYawAddr != IntPtr.Zero ? ReadFloat(hLeader, leaderYawAddr) : null;
            float? pitch = leaderPitchAddr != IntPtr.Zero ? ReadFloat(hLeader, leaderPitchAddr) : null;
            float? zoom = leaderZoomAddr != IntPtr.Zero ? ReadFloat(hLeader, leaderZoomAddr) : null;

            if (!yaw.HasValue && !pitch.HasValue && !zoom.HasValue)
            {
                result["error"] = "Não foi possível ler a câmera do líder.";
                return result;
            }

            var leaderCam = new JsonObject();
            if (yaw.HasValue) leaderCam["yaw"] = yaw.Value;
            if (pitch.HasValue) leaderCam["pitch"] = pitch.Value;
            if (zoom.HasValue) leaderCam["zoom"] = zoom.Value;
            result["camera"] = leaderCam;

            int aligned = 0;
            foreach (var fPid in followerPids)
            {
                if (fPid == 0 || fPid == leaderPid) continue;
                var hFollower = OpenForWrite(fPid);
                if (hFollower == IntPtr.Zero) continue;

                try
                {
                    var fMod = GetModuleBase(fPid, moduleName);
                    var fRoot = IntPtr.Add(fMod, (int)baseRva);

                    if (yaw.HasValue)
                    {
                        var fYawAddr = ResolvePointerChain(hFollower, fRoot, yawChain);
                        if (fYawAddr != IntPtr.Zero) WriteFloat(hFollower, fYawAddr, yaw.Value);
                    }
                    if (pitch.HasValue)
                    {
                        var fPitchAddr = ResolvePointerChain(hFollower, fRoot, pitchChain);
                        if (fPitchAddr != IntPtr.Zero) WriteFloat(hFollower, fPitchAddr, pitch.Value);
                    }
                    if (zoom.HasValue)
                    {
                        var fZoomAddr = ResolvePointerChain(hFollower, fRoot, zoomChain);
                        if (fZoomAddr != IntPtr.Zero) WriteFloat(hFollower, fZoomAddr, zoom.Value);
                    }
                    aligned++;
                }
                finally
                {
                    CloseHandle(hFollower);
                }
            }

            result["alignedCount"] = aligned;
            result["ok"] = true;
            return result;
        }
        catch (Exception ex)
        {
            result["error"] = ex.Message;
            return result;
        }
        finally
        {
            CloseHandle(hLeader);
        }
    }

    /// <summary>
    /// Retorna métricas de CPU e Memória para os PIDs solicitados.
    /// </summary>
    public static JsonArray GetMetrics(uint[] pids)
    {
        var arr = new JsonArray();
        var now = DateTime.UtcNow;

        foreach (var pid in pids)
        {
            if (pid == 0) continue;
            try
            {
                using var proc = Process.GetProcessById((int)pid);
                proc.Refresh();

                double cpuPercent = 0.0;
                var currentCpu = proc.TotalProcessorTime;

                if (CpuSamples.TryGetValue(pid, out var prev))
                {
                    var timeDelta = (now - prev.time).TotalMilliseconds;
                    var cpuDelta = (currentCpu - prev.cpu).TotalMilliseconds;
                    if (timeDelta > 0)
                    {
                        cpuPercent = Math.Round((cpuDelta / (timeDelta * Environment.ProcessorCount)) * 100.0, 1);
                        if (cpuPercent < 0) cpuPercent = 0;
                        if (cpuPercent > 100) cpuPercent = 100;
                    }
                }
                CpuSamples[pid] = (now, currentCpu);

                long memoryBytes = proc.WorkingSet64;
                double memoryMb = Math.Round(memoryBytes / (1024.0 * 1024.0), 1);

                arr.Add(new JsonObject
                {
                    ["pid"] = pid,
                    ["cpuPercent"] = cpuPercent,
                    ["memoryBytes"] = memoryBytes,
                    ["memoryMb"] = memoryMb,
                    ["responding"] = proc.Responding
                });
            }
            catch
            {
                CpuSamples.Remove(pid);
                arr.Add(new JsonObject
                {
                    ["pid"] = pid,
                    ["cpuPercent"] = 0.0,
                    ["memoryBytes"] = 0,
                    ["memoryMb"] = 0.0,
                    ["responding"] = false
                });
            }
        }

        return arr;
    }

    /// <summary>
    /// Lê os slots de equipamentos equipados pelo personagem no jogo.
    /// </summary>
    public static JsonObject ReadEquipment(uint pid, JsonObject config)
    {
        var result = new JsonObject { ["pid"] = pid, ["ok"] = false, ["slots"] = new JsonArray() };
        var hProc = OpenForRead(pid);
        if (hProc == IntPtr.Zero) return result;

        try
        {
            string? moduleName = config["module"]?.GetValue<string>() ?? "ElementClient.exe";
            var modBase = GetModuleBase(pid, moduleName);
            if (modBase == IntPtr.Zero) return result;

            long baseVa = 0;
            if (config["player"] is JsonObject pObj && pObj.TryGetPropertyValue("static_va", out var sva) && sva != null)
                baseVa = ParseHexOrLong(sva.GetValue<string>());
            else if (config.TryGetPropertyValue("base", out var bNode) && bNode != null)
                baseVa = ParseHexOrLong(bNode.GetValue<string>());

            var chain = ParseOffsetChain(config["player"]?["chain"] ?? config["chain"]);
            var rootAddr = IntPtr.Add(modBase, (int)baseVa);
            var playerAddr = ResolvePointerChain(hProc, rootAddr, chain);
            if (playerAddr == IntPtr.Zero) return result;

            long invOffset = ParseHexOrLong(config["inventory"]?["offset"]?.GetValue<string>() ?? "0x1074");
            long arrayOffset = ParseHexOrLong(config["inventory"]?["array"]?.GetValue<string>() ?? "0xC");
            long refineOffset = ParseHexOrLong(config["equip"]?["refine"]?.GetValue<string>() ?? "0x90");
            long holesOffset = ParseHexOrLong(config["equip"]?["holes"]?["count"]?.GetValue<string>() ?? "0xA0");
            long itemTidOffset = ParseHexOrLong(config["item"]?["tid"]?.GetValue<string>() ?? "0xC");

            var invPtrAddr = IntPtr.Add(playerAddr, (int)invOffset);
            var invPtr = ReadInt32(hProc, invPtrAddr);
            if (!invPtr.HasValue || invPtr.Value == 0) return result;

            var arrayPtrAddr = IntPtr.Add((IntPtr)invPtr.Value, (int)arrayOffset);
            var arrayPtr = ReadInt32(hProc, arrayPtrAddr);
            if (!arrayPtr.HasValue || arrayPtr.Value == 0) return result;

            var slotsArr = new JsonArray();
            for (int i = 0; i < 16; i++)
            {
                var slotPtrAddr = IntPtr.Add((IntPtr)arrayPtr.Value, i * 4);
                var slotPtr = ReadInt32(hProc, slotPtrAddr);
                if (!slotPtr.HasValue || slotPtr.Value == 0)
                {
                    slotsArr.Add(new JsonObject { ["slot"] = i, ["empty"] = true });
                    continue;
                }

                var tid = ReadInt32(hProc, IntPtr.Add((IntPtr)slotPtr.Value, (int)itemTidOffset)) ?? 0;
                var refine = ReadInt32(hProc, IntPtr.Add((IntPtr)slotPtr.Value, (int)refineOffset)) ?? 0;
                var holes = ReadInt32(hProc, IntPtr.Add((IntPtr)slotPtr.Value, (int)holesOffset)) ?? 0;

                slotsArr.Add(new JsonObject
                {
                    ["slot"] = i,
                    ["empty"] = false,
                    ["itemId"] = tid,
                    ["refine"] = Math.Clamp(refine, 0, 12),
                    ["holes"] = Math.Clamp(holes, 0, 8)
                });
            }

            result["slots"] = slotsArr;
            result["ok"] = true;
            return result;
        }
        catch
        {
            return result;
        }
        finally
        {
            CloseHandle(hProc);
        }
    }

    private static int[] ParseOffsetChain(JsonNode? node)
    {
        if (node is JsonArray arr)
        {
            var list = new List<int>();
            foreach (var item in arr)
            {
                if (item == null) continue;
                if (item is JsonValue jv && jv.TryGetValue<string>(out var s))
                    list.Add((int)ParseHexOrLong(s));
                else if (item.AsValue().TryGetValue<int>(out var n))
                    list.Add(n);
            }
            return list.ToArray();
        }
        return Array.Empty<int>();
    }

    private static long ParseHexOrLong(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return 0;
        s = s.Trim();
        if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            return Convert.ToInt64(s[2..], 16);
        return long.TryParse(s, out var v) ? v : 0;
    }
}
