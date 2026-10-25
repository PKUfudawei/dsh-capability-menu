/**
 * Build the command line handed to `cmd.exe /d /s /c`. The line is wrapped in
 * one extra pair of quotes because `/s` strips the first and the last quote and
 * leaves everything in between untouched; every argument is quoted so paths with
 * spaces survive. Arguments cmd.exe cannot represent are refused rather than
 * silently split.
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