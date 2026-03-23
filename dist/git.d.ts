export interface FileStats {
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
}
export interface GitStatus {
    branch: string;
    isDirty: boolean;
    ahead: number;
    behind: number;
    fileStats?: FileStats;
    /** Set when cwd is a linked worktree; contains the main repo root path */
    mainRepoPath?: string;
}
export declare function getGitBranch(cwd?: string): Promise<string | null>;
export declare function getGitStatus(cwd?: string): Promise<GitStatus | null>;
//# sourceMappingURL=git.d.ts.map