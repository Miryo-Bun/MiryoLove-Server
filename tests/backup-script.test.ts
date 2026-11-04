import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("../scripts/backup.sh", import.meta.url));

describe("backup script safety", () => {
  it("refuses a passphrase stored inside the backup directory before accessing Docker", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "miryolove-backup-test-"));
    try {
      const backupDirectory = join(temporaryRoot, "backups");
      const fakeBin = join(temporaryRoot, "bin");
      mkdirSync(backupDirectory);
      mkdirSync(fakeBin);

      const passphrasePath = join(backupDirectory, "passphrase");
      writeFileSync(passphrasePath, "non-secret-test-value\n", { mode: 0o600 });
      for (const command of ["docker", "gpg", "pg_restore", "tar", "gzip", "sha256sum"]) {
        const commandPath = join(fakeBin, command);
        writeFileSync(commandPath, "#!/bin/sh\nexit 0\n");
        chmodSync(commandPath, 0o700);
      }

      const result = spawnSync("bash", [scriptPath, "daily"], {
        encoding: "utf8",
        env: {
          ...process.env,
          BACKUP_DIR: backupDirectory,
          BACKUP_PASSPHRASE_FILE: passphrasePath,
          PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "Backup passphrase must not be stored in the backup directory.",
      );
      expect(readdirSync(backupDirectory)).toEqual(["passphrase"]);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
