// ─── Tool Definitions ────────���──────────────────────────────────────
// Extracted from App.tsx

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'update_working_memory',
      description: 'Update your short-term memory to avoid losing context. Call this when you complete a step or change goals.',
      parameters: {
        type: 'object',
        properties: {
          current_goal: { type: 'string' },
          done_steps: { type: 'string' },
          open_tasks: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_command',
      description: 'Execute a PowerShell command on the Windows system',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The PowerShell command to execute' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file path to read' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file path to write' },
          content: { type: 'string', description: 'The content to write' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web using DuckDuckGo',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and folders in a directory',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_file_or_url',
      description: 'Open a file or URL with the default application',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'File path or URL to open' }
        },
        required: ['target']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'plan_tasks',
      description: 'Create a task plan to decompose a complex request into subtasks. Use this for multi-step goals.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'The overall goal' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                status: { type: 'string', description: 'pending | in_progress | done | failed' }
              }
            },
            description: 'List of subtasks'
          }
        },
        required: ['goal', 'tasks']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_task_status',
      description: 'Update the status of a subtask in the current plan.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          status: { type: 'string', description: 'pending | in_progress | done | failed' },
          result: { type: 'string', description: 'Optional result or note' }
        },
        required: ['task_id', 'status']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: 'Open a browser and navigate to a URL. Returns page title and text content.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_text',
      description: 'Get the text content of the current browser page.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click an element on the page by CSS selector.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the element to click' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Type text into an input field by CSS selector.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the input' },
          text: { type: 'string', description: 'Text to type' }
        },
        required: ['selector', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_command',
      description: 'Run a git command in a specified directory. Supports: status, diff, log, add, commit, branch, checkout, stash. Use for version control awareness.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The git subcommand and args (e.g. "status", "diff --stat", "log --oneline -10", "add .", "commit -m msg")' },
          cwd: { type: 'string', description: 'Working directory (the repo path)' }
        },
        required: ['command', 'cwd']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'undo_last_write',
      description: 'Undo the last file write operation, restoring the file to its previous state. Use when a write produced errors or bad results.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delegate_subtasks',
      description: 'Run multiple subtasks in parallel using collaborative agents. Each subtask gets its own AI instance.',
      parameters: {
        type: 'object',
        properties: {
          subtasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                prompt: { type: 'string', description: 'The instruction for this agent' }
              }
            },
            description: 'List of subtasks to execute in parallel'
          }
        },
        required: ['subtasks']
      }
    }
  }
]

// Safety limits
export const AGENT_SAFETY_LIMIT = 200
export const NORMAL_SAFETY_LIMIT = 50
export const IDLE_STEP_THRESHOLD = 5

// Permission sets
export const SAFE_TOOLS = new Set([
  'read_file', 'list_directory', 'web_search', 'browser_get_text',
  'update_working_memory', 'plan_tasks', 'update_task_status', 'undo_last_write'
])

export const DANGEROUS_TOOLS = new Set([
  'execute_command', 'write_file', 'open_file_or_url', 'git_command',
  'browser_navigate', 'browser_click', 'browser_type', 'delegate_subtasks'
])
