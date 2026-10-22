import fs from "node:fs/promises";
import path from "node:path";

export async function readSupplierRegistry(filePath) {
  try {
    const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
    return Array.isArray(payload) ? payload : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error(`Leverandørregisteret kunne ikke leses: ${error.message || error}`);
  }
}

export async function writeSupplierRegistry(filePath, suppliers) {
  if (!Array.isArray(suppliers)) throw new TypeError("Leverandørregisteret må være en liste.");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const payload = `${JSON.stringify(suppliers, null, 2)}\n`;
  await fs.writeFile(temporaryPath, payload, "utf8");
  await fs.rename(temporaryPath, filePath);
}
