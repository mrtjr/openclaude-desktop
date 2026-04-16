/// <reference types="vite/client" />

interface Window {
  electron: {
    compactContext: (params: { messages: any[]; model: string; language: string }) => Promise<{ summary: string; error: string | null }>
    ollamaChat: (params: any) => Promise<any>
    ollamaChatStream: (params: any) => Promise<any>
    onStreamChunk: (callback: (chunk: any) => void) => () => void
    execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; error: string | null }>
    gitCommand: (params: { command: string; cwd: string }) => Promise<{ stdout: string; stderr: string; error: string | null }>
    readFile: (path: string) => Promise<{ content: string | null; error: string | null }>
    writeFile: (params: { filePath: string; content: string }) => Promise<{ error: string | null }>
    undoLastWrite: () => Promise<{ error: string | null; restored: string | null }>
    listSnapshots: () => Promise<{ filePath: string; timestamp: number; fileName: string }[]>
    listModels: () => Promise<any>
    saveConversations: (data: any) => Promise<{ error: string | null }>
    loadConversations: () => Promise<any>
    webSearch: (query: string) => Promise<{ result: string | null; error: string | null }>
    listDirectory: (path: string) => Promise<{ items: any[] | null; error: string | null }>
    openTarget: (target: string) => Promise<{ error: string | null }>
    checkOllamaStatus: () => Promise<boolean>
    getAutoStart: () => Promise<boolean>
    setAutoStart: (enabled: boolean) => Promise<{ error: string | null }>
    saveDialog: (opts: any) => Promise<{ filePath: string | null; error: string | null }>
    openFileDialog: (opts?: any) => Promise<{ filePaths: string[]; canceled: boolean }>
    readDroppedFile: (path: string) => Promise<{ content: string | null; name?: string; error: string | null }>
    readDocument: (filePath: string) => Promise<{ content: string | null; error: string | null }>
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    checkForUpdates: () => Promise<{ updateAvailable: boolean; releaseUrl?: string; latestVersion?: string; error?: string }>
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
    browserNavigate: (url: string) => Promise<{ success?: boolean; url?: string; title?: string; text?: string; error?: string }>
    browserScreenshot: () => Promise<{ success?: boolean; base64?: string; size?: number; error?: string }>
    browserGetText: (opts?: { selector?: string; maxLength?: number }) => Promise<{ success?: boolean; text?: string; error?: string }>
    browserClick: (selector: string) => Promise<{ success?: boolean; tag?: string; text?: string; error?: string }>
    browserType: (params: { selector: string; text: string; pressEnter?: boolean }) => Promise<{ success?: boolean; error?: string }>
    browserEvaluate: (code: string) => Promise<{ success?: boolean; result?: string; error?: string }>
    browserWait: (params: { selector: string; timeout?: number }) => Promise<{ success?: boolean; found?: boolean; error?: string }>
    browserGetLinks: () => Promise<{ success?: boolean; links?: Array<{ text: string; href: string }>; error?: string }>
    browserGetForms: () => Promise<{ success?: boolean; forms?: Array<{ tag: string; type: string; name: string; placeholder: string; selector: string; value: string }>; error?: string }>
    browserClose: (tabId?: string) => Promise<{ success?: boolean; error?: string }>
    browserTabs: () => Promise<{ tabs: Array<{ id: string; active: boolean; url: string; title: string }>; activeTabId: string }>
    browserSwitchTab: (tabId: string) => Promise<{ success?: boolean; tabId?: string; error?: string }>
    // MCP client
    mcpConnect: (params: any) => Promise<any>
    mcpCallTool: (params: any) => Promise<any>
    mcpDisconnect: (id: string) => Promise<any>
    mcpListConnections: () => Promise<string[]>
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
    // Prompt Vault
    vaultLoad: () => Promise<{ prompts: import('./PromptVault').VaultPrompt[] }>
    vaultSave: (prompts: import('./PromptVault').VaultPrompt[]) => Promise<{ error: string | null }>
    // Persona Engine
    personaLoad: () => Promise<{ personas: import('./PersonaEngine').Persona[] }>
    personaSave: (personas: import('./PersonaEngine').Persona[]) => Promise<{ error: string | null }>
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
    ragSearch: (params: { queryEmbedding: number[]; topK: number }) => Promise<{ results: { text: string; score: number; source: string }[] }>
    ragClear: () => Promise<{ error: string | null }>
    // ORION
    orionCapture: () => Promise<{ base64: string | null; error: string | null }>
    orionRunAction: (params: { type: string; params: Record<string, any> }) => Promise<{ output: string; error: string | null }>
    // Workflow
    workflowLoad: () => Promise<{ workflows: any[] }>
    workflowSave: (workflows: any[]) => Promise<{ error: string | null }>
  }
}
