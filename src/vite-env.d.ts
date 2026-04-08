/// <reference types="vite/client" />

interface Window {
  electron: {
    ollamaChat: (params: any) => Promise<any>
    ollamaChatStream: (params: any) => Promise<any>
    onStreamChunk: (callback: (chunk: any) => void) => () => void
    execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; error: string | null }>
    readFile: (path: string) => Promise<{ content: string | null; error: string | null }>
    writeFile: (params: { filePath: string; content: string }) => Promise<{ error: string | null }>
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
    readDroppedFile: (path: string) => Promise<{ content: string | null; name?: string; error: string | null }>
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    checkForUpdates: () => Promise<{ updateAvailable: boolean; releaseUrl?: string; latestVersion?: string; error?: string }>
    abortStream: () => Promise<{ aborted: boolean }>
    loadMemory: () => Promise<any>
    saveMemory: (data: any) => Promise<{ error: string | null }>
    providerChat: (params: any) => Promise<any>
    // Browser automation
    browserLaunch: () => Promise<any>
    browserNavigate: (url: string) => Promise<any>
    browserScreenshot: () => Promise<any>
    browserGetText: () => Promise<any>
    browserClick: (selector: string) => Promise<any>
    browserType: (params: { selector: string; text: string }) => Promise<any>
    browserEvaluate: (code: string) => Promise<any>
    browserClose: () => Promise<any>
    // MCP client
    mcpConnect: (params: any) => Promise<any>
    mcpCallTool: (params: any) => Promise<any>
    mcpDisconnect: (id: string) => Promise<any>
    mcpListConnections: () => Promise<string[]>
    // Collaborative agents
    parallelChat: (params: any) => Promise<any>
  }
}
