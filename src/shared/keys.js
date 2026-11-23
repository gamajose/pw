// Tabela de teclas usada pelos presets (nome exibido -> código virtual do Windows).
// Compartilhada entre o processo principal e a interface.

const table = [];

for (let i = 1; i <= 12; i++) table.push([`F${i}`, 0x6f + i]);
for (let i = 0; i <= 9; i++) table.push([String(i), 0x30 + i]);
for (let c = 65; c <= 90; c++) table.push([String.fromCharCode(c), c]);
for (let i = 0; i <= 9; i++) table.push([`Num${i}`, 0x60 + i]);

table.push(
  ['Tab', 0x09],
  ['Espaço', 0x20],
  ['Enter', 0x0d],
  ['Esc', 0x1b],
  ['Backspace', 0x08],
  ['Shift', 0x10],
  ['Ctrl', 0x11],
  ['Alt', 0x12],
  ['Seta ←', 0x25],
  ['Seta ↑', 0x26],
  ['Seta →', 0x27],
  ['Seta ↓', 0x28],
  ['Insert', 0x2d],
  ['Delete', 0x2e],
  ['Home', 0x24],
  ['End', 0x23],
  ['PageUp', 0x21],
  ['PageDown', 0x22],
  ['-', 0xbd],
  ['=', 0xbb],
  ['`', 0xc0],
);

export const KEYS = table.map(([name, vk]) => ({ name, vk }));

const byName = new Map(KEYS.map((k) => [k.name.toLowerCase(), k.vk]));

export function vkFromName(name) {
  if (name == null) return 0;
  return byName.get(String(name).toLowerCase()) ?? 0;
}

// Converte a tecla final de um acelerador do Electron ("Ctrl+Shift+F1", "num3") em VK,
// para que o Sync action nunca espelhe atalhos do próprio PW Manager.
export function vkFromAccelerator(accel) {
  if (!accel) return 0;
  const last = String(accel).split('+').pop().trim();
  const m = /^num(\d)$/i.exec(last);
  if (m) return 0x60 + Number(m[1]);
  if (/^space$/i.test(last)) return 0x20;
  return vkFromName(last);
}

// Só o que é seguro/útil espelhar no Sync action (o módulo nativo aplica a mesma regra).
export function isMirrorable(vk) {
  return (vk >= 0x70 && vk <= 0x7b) || (vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5a) || vk === 0x09 || vk === 0x20;
}
