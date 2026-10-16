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