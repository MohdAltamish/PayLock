import { execSync } from "node:child_process";
import path from "node:path";

/** Delete demo deals and re-base persona ages so every run starts the same (decision L). */
export default function globalSetup() {
  execSync("npm run demo:reset", {
    cwd: path.resolve(import.meta.dirname, "../../.."),
    stdio: "inherit",
  });
}
