/// <reference types="vite/client" />

/** Injected by Vite `define` from package.json at build time. */
declare const __APP_VERSION__: string

interface Window {
  electron: {
    ollamaChat: (params: any) => Promise<any>
    ollamaChatStream: (params: any) => Promise<any>
    onStreamChunk: (callback: (chunk: any) => void) => () => void
    execCommand: (cmd: string | { command: string; cwd?: string; timeoutMs?: number; env?: Record<string, string> }) => Promise<{ stdout: string; stderr: string; exitCode?: number; timedOut?: boolean; killedByUser?: boolean; timeoutMs?: number; error: string | null }>
    killCommands: () => Promise<{ killed: number }>
    startBackgroundCommand: (params: { command: string; cwd?: string }) => Promise<{ id?: string; pid?: number; error?: string | null }>
    commandOutput: (params: { id: string }) => Promise<{ found?: boolean; running?: boolean; exitCode?: number | null; killedByUser?: boolean; stdout?: string; stderr?: string; elapsedMs?: number }>
    killBackgroundCommand: (params: { id: string }) => Promise<{ found?: boolean; killed?: boolean }>
    gitCommand: (params: { command: string; cwd: string }) => Promise<{ stdout: string; stderr: string; error: string | null }>
    readFile: (path: string) => Promise<{ content: string | null; error: string | null }>
    getPathForFile?: (file: File) => string
    writeFile: (params: { filePath: string; content: string; append?: boolean; appendIfExists?: boolean }) => Promise<{ error: string | null; existed?: boolean; appended?: boolean; bytes?: number }>
    editFile: (params: { filePath: string; oldString: string; newString: string; replaceAll?: boolean }) => Promise<{ error: string | null; replaced?: boolean; occurrences?: number }>
    searchFiles: (params: { query: string; path?: string; exts?: string[] | null; maxResults?: number; caseSensitive?: boolean }) => Promise<{ matches?: { file: string; line: number; text: string }[]; filesScanned?: number; truncated?: boolean; error?: string | null }>
    undoLastWrite: () => Promise<{ error: string | null; restored: string | null }>
    listSnapshots: () => Promise<{ filePath: string; timestamp: number; fileName: string }[]>
    checkpointMark: () => Promise<{ seq: number }>
    checkpointCount: (seq: number) => Promise<{ count: number }>
    checkpointRestore: (seq: number) => Promise<{ restored: string[]; count: number; errors: string[] }>
    listModels: () => Promise<any>
    saveConversations: (data: any) => Promise<{ error: string | null }>
    loadConversations: () => Promise<any>
    webSearch: (query: string) => Promise<{ result: string | null; error: string | null }>
    fetchUrl: (url: string) => Promise<{ success?: boolean; url?: string; title?: string; text?: string; thin?: boolean; truncated?: boolean; error?: string }>
    listDirectory: (path: string) => Promise<{ items: any[] | null; error: string | null }>
    openTarget: (target: string) => Promise<{ error: string | null }>
    checkOllamaStatus: () => Promise<boolean>
    getAutoStart: () => Promise<boolean>
    setAutoStart: (enabled: boolean) => Promise<{ error: string | null }>
    saveDialog: (opts: any) => Promise<{ filePath: string | null; error: string | null }>
    openFileDialog: (opts?: any) => Promise<{ filePaths: string[]; canceled: boolean }>
    openFolderDialog: () => Promise<{ path: string | null; error?: string | null }>
    reportLoad: (params: { id: string }) => Promise<{ content: string; error?: string | null }>
    reportSave: (params: { id: string; content: string }) => Promise<{ error: string | null }>
    reportDelete: (params: { id: string }) => Promise<{ error: string | null }>
    readDroppedFile: (path: string) => Promise<{ content: string | null; name?: string; error: string | null }>
    exportUserData: () => Promise<{ files: Record<string, unknown>; error: string | null }>
    importUserData: (payload: { files: Record<string, unknown> }) => Promise<{ restored: number; error: string | null }>
    readDocument: (filePath: string) => Promise<{ content: string | null; base64?: string; mimeType?: string; name?: string; isImage?: boolean; pages?: number; error: string | null }>
    importSkillsDir?: () => Promise<{ files: { path: string; content: string }[]; root: string | null; error: string | null }>
    fetchGithubSkills?: (spec: { owner: string; repo: string; branch?: string }) => Promise<{ files: { path: string; content: string }[]; dir?: string; branch?: string; found?: number; error: string | null }>
    fetchGithubIndex?: (spec: { owner: string; repo: string; branch?: string }) => Promise<{ content: string; error: string | null }>
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    checkForUpdates: () => Promise<{ updateAvailable: boolean; releaseUrl?: string; latestVersion?: string; error?: string }>
    quitAndInstall: () => Promise<{ ok?: boolean; error?: string }>
    onUpdateStatus: (cb: (data: { state: 'available' | 'downloading' | 'downloaded' | 'none' | 'error'; version?: string; percent?: number; message?: string }) => void) => () => void
    abortStream: () => Promise<{ aborted: boolean }>
    loadMemory: () => Promise<any>
    saveMemory: (data: any) => Promise<{ error: string | null }>
    loadAgentMemory: () => Promise<any>
    saveAgentMemory: (data: any) => Promise<{ error: string | null }>
    providerChat: (params: any) => Promise<any>
    providerChatStream: (params: any) => Promise<any>
    listProviderModels: (params: { provider: string; apiKey: string }) => Promise<{ models?: string[]; error?: string | null }>
    // MCP Settings
    saveMcpServers: (servers: { name: string; command: string }[]) => Promise<{ error: string | null }>
    loadMcpServers: () => Promise<{ servers: { name: string; command: string }[] }>
    // Browser automation (Electron BrowserWindow nativo)
    browserLaunch: (opts?: { visible?: boolean }) => Promise<{ success?: boolean; tabId?: string; error?: string }>
    browserNavigate: (url: string) => Promise<{ success?: boolean; url?: string; title?: string; text?: string; error?: string; partial?: boolean; note?: string; elements?: { links?: { text: string; href: string }[]; fields?: { tag: string; type: string; placeholder: string; selector: string }[] } }>
    browserScreenshot: () => Promise<{ success?: boolean; base64?: string; mime?: string; width?: number; height?: number; size?: number; error?: string }>
    browserGetText: (opts?: { selector?: string; maxLength?: number }) => Promise<{ success?: boolean; text?: string; error?: string }>
    browserClick: (selector: string) => Promise<{ success?: boolean; tag?: string; text?: string; error?: string; candidates?: { selector: string; text: string; tag: string }[] }>
    browserType: (params: { selector: string; text: string; pressEnter?: boolean }) => Promise<{ success?: boolean; error?: string }>
    browserEvaluate: (code: string) => Promise<{ success?: boolean; result?: string; error?: string }>
    browserWait: (params: { selector: string; timeout?: number }) => Promise<{ success?: boolean; found?: boolean; error?: string }>
    browserGetLinks: () => Promise<{ success?: boolean; links?: Array<{ text: string; href: string }>; error?: string }>
    browserGetForms: () => Promise<{ success?: boolean; forms?: Array<{ tag: string; type: string; name: string; placeholder: string; selector: string; value: string }>; error?: string }>
    browserClose: (tabId?: string) => Promise<{ success?: boolean; error?: string }>
    browserTabs: () => Promise<{ tabs: Array<{ id: string; active: boolean; url: string; title: string }>; activeTabId: string }>
    browserSwitchTab: (tabId: string) => Promise<{ success?: boolean; tabId?: string; error?: string }>
    // Computer Use (vision-based coordinate interaction — like Claude/Manus)
    browserClickAt: (params: { x: number; y: number }) => Promise<{ success?: boolean; x?: number; y?: number; error?: string }>
    browserDoubleClickAt: (params: { x: number; y: number }) => Promise<{ success?: boolean; x?: number; y?: number; error?: string }>
    browserTypeText: (params: { text: string; pressEnter?: boolean }) => Promise<{ success?: boolean; error?: string }>
    browserKeyPress: (params: { key: string; modifiers?: string[] }) => Promise<{ success?: boolean; error?: string }>
    browserScroll: (params: { deltaY?: number; deltaX?: number; x?: number; y?: number }) => Promise<{ success?: boolean; error?: string }>
    browserScreenshotVision: () => Promise<{ success?: boolean; base64?: string; width?: number; height?: number; size?: number; error?: string }>
    onBrowserPageLoaded: (callback: (data: { tabId: string; url: string; title: string }) => void) => () => void
    // MCP client
    mcpConnect: (params: any) => Promise<any>
    mcpCallTool: (params: any) => Promise<any>
    mcpDisconnect: (id: string) => Promise<any>
    mcpListConnections: () => Promise<string[]>
    onMcpServerExit: (callback: (data: { id: string }) => void) => () => void
    // Collaborative agents
    parallelChat: (params: import('./types/ipc').ParallelChatParams) => Promise<import('./types/ipc').ParallelChatResult[]>
    providerParallelChat: (params: import('./types/ipc').ProviderParallelChatParams) => Promise<import('./types/ipc').ParallelChatResult[]>
    // Parliament Mode — Multi-Agent Debate
    parliamentDebate: (params: any) => Promise<{ roles: any[]; coordinator: string; sessionId: string }>
    onParliamentRoleDone: (callback: (result: any) => void) => () => void
    onParliamentCoordinatorDone: (callback: (result: any) => void) => () => void
    onParliamentCoordinatorStart: (callback: (data: any) => void) => () => void
    // Audit Log
    auditLogAppend: (entry: any) => Promise<{ error: string | null }>
    auditLogLoad: () => Promise<any[]>
    auditLogClear: () => Promise<{ error: string | null }>
    // Analytics (MCD/MAGI/MASA)
    analyticsSaveSession: (data: any) => Promise<{ error: string | null }>
    analyticsLoad: () => Promise<any>
    analyticsGetInsights: () => Promise<any>
    analyticsClear: () => Promise<{ error: string | null }>
    // Dev Insights (privacy-safe usage telemetry — events + metadata only)
    devInsightsFlush: (payload: { events: import('./services/devInsights').InsightEvent[]; digest?: import('./services/devInsights').InsightsDigest }) => Promise<{ error: string | null }>
    devInsightsLoad: () => Promise<import('./services/devInsights').InsightEvent[]>
    devInsightsClear: () => Promise<{ error: string | null }>
    // Prompt Vault
    vaultLoad: () => Promise<{ prompts: import('./PromptVault').VaultPrompt[] }>
    vaultSave: (prompts: import('./PromptVault').VaultPrompt[]) => Promise<{ error: string | null }>
    // Persona Engine
    personaLoad: () => Promise<{ personas: import('./PersonaEngine').Persona[] }>
    personaSave: (personas: import('./PersonaEngine').Persona[]) => Promise<{ error: string | null }>
    skillLoad?: () => Promise<{ skills: import('./types/skill').Skill[]; error?: string }>
    skillSave?: (skills: import('./types/skill').Skill[]) => Promise<{ error: string | null }>
    // Model Arena
    arenaLoad: () => Promise<{ scores: import('./ModelArena').ArenaScore[] }>
    arenaSave: (scores: import('./ModelArena').ArenaScore[]) => Promise<{ error: string | null }>
    // Code Workspace
    workspaceTree: (dirPath: string) => Promise<{ tree: import('./CodeWorkspace').TreeNode[]; error: string | null }>
    // Vision Mode
    captureScreen: () => Promise<{ base64: string | null; error: string | null }>
    visionChat: (params: { provider: string; apiKey: string; model: string; prompt: string; imageBase64: string; modalHostname?: string }) => Promise<{ response: string | null; error: string | null }>
    // RAG
    ragEmbed: (params: { model: string; text: string }) => Promise<{ embedding: number[]; error: string | null }>
    ragIndexLoad: () => Promise<{ chunks: any[] }>
    ragIndexSave: (chunks: any[]) => Promise<{ error: string | null }>
    ragSearch: (params: { queryEmbedding: number[]; topK: number }) => Promise<{ results: { text: string; score: number; source: string }[]; error?: string }>
    ragStats: () => Promise<{ count: number; sources: string[]; error?: string }>
    ragClear: () => Promise<{ error: string | null }>
    // ORION
    orionCapture: () => Promise<{ base64: string | null; error: string | null }>
    orionRunAction: (params: { type: string; params: Record<string, any> }) => Promise<{ output: string; error: string | null }>
    // Workflow
    workflowLoad: () => Promise<{ workflows: any[] }>
    workflowSave: (workflows: any[]) => Promise<{ error: string | null }>
    // v2.12.0: Native notifications
    showNotification?: (opts: { title?: string; body?: string; silent?: boolean }) => Promise<{ ok: boolean; error?: string }>
    isWindowFocused?: () => Promise<{ focused: boolean }>
    // OAuth
    oauthGoogleStart?: (params: any) => Promise<any>
    // Servidor remoto p/ o app do celular (PWA) — v2.191.0
    remoteServerStart?: (params?: { port?: number }) => Promise<{ ok?: boolean; port?: number; token?: string; addresses?: { address: string; iface: string; tailscale: boolean }[]; error?: string }>
    remoteServerStop?: () => Promise<{ ok?: boolean; error?: string }>
    remoteServerStatus?: () => Promise<{ running: boolean; port: number; token: string; addresses: { address: string; iface: string; tailscale: boolean }[] }>
    remoteServerConfig?: (cfg: { provider?: string; model?: string; models?: string[]; targets?: { id: string; label: string; provider: string; model: string }[] }) => Promise<{ ok: boolean }>
    remoteServerRegenToken?: () => Promise<{ token: string }>
    onRemoteChatRequest?: (callback: (req: { id: string; messages: { role: string; content: string }[]; model?: string; provider?: string }) => void) => () => void
    remoteChatReply?: (data: { id: string; text?: string; error?: string; model?: string }) => void
  }
}
