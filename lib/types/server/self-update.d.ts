/**
 * Build the command line handed to `cmd.exe /d /s /c`. The line is wrapped in
 * one extra pair of quotes because `/s` strips the first and the last quote and
 * leaves the remaining quotes in place. Reject shell expansion characters too:
 * double quotes do not stop cmd.exe from expanding environment variables.
 * Profile paths are passed via cwd, never through this command line.
 */
export declare function windowsCommand(file: string, args: string[]): string;
export interface SelfUpdateStatus {
    current: string;
    latest: string;
    updateAvailable: boolean;
    updatable: boolean;
    reason?: 'local' | 'non-registry' | 'profile-unavailable';
    sourcePath?: string;
}
export declare function checkSelfUpdate(): Promise<SelfUpdateStatus>;
export declare function installSelfUpdate(version: string): Promise<void>;
export declare function switchSelfToNpm(version: string): Promise<void>;
//# sourceMappingURL=self-update.d.ts.map