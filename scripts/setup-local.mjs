import { access, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
try {
  await access(".env.local");
  console.log(
    ".env.local already exists; it was preserved. Configure local replay or live credentials there.",
  );
} catch {
  await mkdir(".local", { recursive: true });
  await writeFile(
    ".env.local",
    `APP_ORIGIN=http://localhost:3000\nLOCAL_DEMO_ENABLED=true\nLOCAL_DATABASE_PATH=.local/daybook\nLOCAL_SESSION_SECRET=${randomBytes(48).toString("hex")}\nDEMO_MODE_ENABLED=true\n`,
    { mode: 0o600 },
  );
  console.log(
    "Local synthetic replay configured. Run npm run db:migrate, then npm run dev. No provider keys were created.",
  );
}
