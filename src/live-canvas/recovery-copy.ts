import { ERROR_RECOVERY_MESSAGE, ERROR_RECOVERY_MOVE, type ErrorCode } from "../revisioned-workspace/schemas";

/**
 * The one recovery copy the shell's Activity strip and the workbench's
 * error strip both render (stage 4): code chips stay machine-readable, the
 * sentences stay human. Owned beside the copy it re-exports so neither
 * surface re-derives it.
 */
export function recoveryCopy(code: ErrorCode): { message: string; move: string } {
  return { message: ERROR_RECOVERY_MESSAGE[code], move: ERROR_RECOVERY_MOVE[code] };
}
