import { exec } from "node:child_process";
import { promisify } from "node:util";
import { ok, err, type Result } from "../domain/result.js";

const execAsync = promisify(exec);

async function createBackupBranch(
  workspaceRoot: string,
): Promise<Result<{ backupBranch: string; originalBranch: string }, Error>> {
  try {
    const { stdout: currentBranch } = await execAsync(
      "git rev-parse --abbrev-ref HEAD",
      { cwd: workspaceRoot },
    );
    const originalBranch = currentBranch.trim();

    const timestamp = Date.now();
    const backupBranch = `refactor-backup-${timestamp}`;

    await execAsync(`git checkout -b ${backupBranch}`, {
      cwd: workspaceRoot,
    });

    await execAsync(`git checkout ${originalBranch}`, {
      cwd: workspaceRoot,
    });

    return ok({ backupBranch, originalBranch });
  } catch (error) {
    return err(
      new Error(`Failed to create backup branch: ${(error as Error).message}`),
    );
  }
}

async function rollbackFromBackup(
  workspaceRoot: string,
  originalBranch: string,
  backupBranch: string,
): Promise<Result<void, Error>> {
  try {
    await execAsync(`git checkout ${originalBranch}`, {
      cwd: workspaceRoot,
    });

    await execAsync(`git reset --hard ${backupBranch}`, {
      cwd: workspaceRoot,
    });

    await deleteBackupBranch(workspaceRoot, backupBranch);

    return ok(undefined);
  } catch (error) {
    return err(
      new Error(`Failed to rollback from backup: ${(error as Error).message}`),
    );
  }
}

async function deleteBackupBranch(
  workspaceRoot: string,
  backupBranch: string,
): Promise<Result<void, Error>> {
  try {
    await execAsync(`git branch -D ${backupBranch}`, {
      cwd: workspaceRoot,
    });
    return ok(undefined);
  } catch {
    return ok(undefined);
  }
}

export { createBackupBranch, rollbackFromBackup, deleteBackupBranch };
