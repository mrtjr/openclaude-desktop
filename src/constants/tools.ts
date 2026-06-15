// ─── Tool Definitions ────────���──────────────────────────────────────
// Extracted from App.tsx

import { subagentRolesHint } from './subagents'

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
      description: 'Execute a PowerShell command on the Windows system. Output includes stderr and the exit code on failure. Default timeout is 60s — pass timeout_s for long-running commands (builds, installs, backtests).',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The PowerShell command to execute' },
          cwd: { type: 'string', description: 'Optional absolute path of the working directory to run in. Defaults to the active project folder when one is set.' },
          timeout_s: { type: 'number', description: 'Optional timeout in seconds (default 60, max 600). Use a higher value when the command is expected to take long, e.g. builds or installs.' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. For LARGE files, pass offset + limit to read a specific line range (the result tells you the total line count and how to continue) instead of getting a blindly-truncated middle.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file path to read' },
          offset: { type: 'number', description: 'Optional 1-based start line to read from' },
          limit: { type: 'number', description: 'Optional number of lines to read from offset' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file (replaces the ENTIRE file). For changing part of an existing file, prefer edit_file.',
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
      name: 'remember_fact',
      description: 'Save a durable note to PERSISTENT memory (survives across ALL future conversations). Use for stable, reusable knowledge: file paths, build commands, the user\'s preferences, project details. Do NOT use for ephemeral task state — use update_working_memory for that.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['fact', 'preference', 'project'], description: 'Which bucket to store it in (default: fact)' },
          content: { type: 'string', description: 'The note to remember, concise and self-contained' }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search file CONTENTS for a text snippet across a directory (like grep). Use this to find where something is defined or mentioned — far faster and more reliable than Select-String via execute_command or reading files one by one. Returns matches as path:line: text.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The literal text to search for (case-insensitive by default)' },
          path: { type: 'string', description: 'Directory to search in (absolute). Defaults to the working directory.' },
          glob: { type: 'string', description: 'Optional filename filter by extension, e.g. "*.ts" or "ts,tsx"' },
          max_results: { type: 'number', description: 'Optional cap on matches (default 100, max 500)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'load_skill',
      description: 'Load the full instructions of an available skill (listed in [SKILLS DISPONÍVEIS]) when it is relevant to the task. Returns the skill\'s detailed playbook to follow. Call this BEFORE acting on a task a skill covers.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The exact skill name from the manifest' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Make a surgical edit to an existing file by replacing an exact text snippet. old_string must appear EXACTLY ONCE in the file (include enough surrounding context to be unique). Far cheaper and safer than rewriting the whole file with write_file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file path to edit' },
          old_string: { type: 'string', description: 'The exact text to find (must be unique in the file)' },
          new_string: { type: 'string', description: 'The text to replace it with' }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web (DuckDuckGo). Returns the top results with title, snippet and a clickable source URL — enough to answer or cite WITHOUT navigating each link. Results are cached for 5 minutes, so do NOT repeat the same query; stop searching once you have enough to answer.',
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
      name: 'fetch_url',
      description: 'Read a web page by URL WITHOUT opening a browser window: does a plain HTTP fetch and returns the page title + extracted text. This is the DEFAULT, preferred way to read or scan a page — fast and with no popup window. Use this instead of browser_navigate for reading. If the result is flagged "(thin/JS-rendered)" or you need to click, fill a form, or screenshot, THEN switch to browser_navigate.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to read (https:// prefix added if missing)' }
        },
        required: ['url']
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
      description: 'Open a URL in the built-in browser for INTERACTION — clicking, typing, screenshots, or JS-heavy / login pages. For merely READING a page, use fetch_url instead (faster, opens no window). The browser uses Electron\'s native Chromium, runs HIDDEN by default (no popup), and only becomes visible for visual tools (screenshot / click-by-coordinate). Returns page title, final URL, and extracted text; handles SPAs and JavaScript-rendered pages.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to (https:// prefix added if missing)' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_text',
      description: 'Get the text content of the current browser page (the one opened by browser_navigate). Optionally extract from a specific CSS selector. Smart extraction: tries <article> or <main> first, falls back to <body>. For a one-off read without an open browser session, use fetch_url instead.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'Optional CSS selector to extract text from (e.g. "article", ".content", "#main")' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click an element on the page by CSS selector. Auto-scrolls the element into view before clicking.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the element to click (e.g. "button.submit", "#login-btn", "a[href=\'/about\']")' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Type text into an input field by CSS selector. Triggers input and change events. Optionally press Enter after typing.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the input (e.g. "#search", "input[name=q]")' },
          text: { type: 'string', description: 'Text to type' },
          pressEnter: { type: 'boolean', description: 'If true, press Enter after typing (useful for search forms)' }
        },
        required: ['selector', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_wait',
      description: 'Wait for a CSS selector to appear on the page. Uses MutationObserver for efficient DOM watching. Returns when element is found or timeout expires.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to wait for' },
          timeout: { type: 'number', description: 'Max wait time in ms (default 5000, max 10000)' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_links',
      description: 'Extract all links (href + text) from the current page. Returns up to 100 links. Useful for mapping a site structure or finding specific pages.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_forms',
      description: 'Discover all form inputs, textareas, selects, and submit buttons on the page. Returns tag, type, name, placeholder, and CSS selector for each. Use this before browser_type to find the correct selectors.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description: 'Capture a screenshot of the current browser page (shown in the app browser window) and return its viewport dimensions. Note: the image pixels are NOT sent back to you — to READ page content use browser_get_text or browser_get_forms; use the returned dimensions to target browser_click_at (x,y).',
      parameters: { type: 'object', properties: {} }
    }
  },
  // ─── Computer Use Tools (vision-based, like Claude/Manus) ──────
  {
    type: 'function',
    function: {
      name: 'browser_click_at',
      description: 'Click at specific pixel coordinates (x, y) in the browser viewport. Use after taking a screenshot and identifying where to click. Coordinates are relative to the top-left of the page viewport.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X coordinate (pixels from left edge)' },
          y: { type: 'number', description: 'Y coordinate (pixels from top edge)' }
        },
        required: ['x', 'y']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_type_text',
      description: 'Type text at the current cursor position in the browser. Use after clicking on an input field with browser_click_at. Types character by character like a real user.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to type' }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_key_press',
      description: 'Press a keyboard key in the browser. Use for Enter, Tab, Escape, Backspace, arrow keys, etc.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key to press: Enter, Tab, Escape, Backspace, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight' }
        },
        required: ['key']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_scroll',
      description: 'Scroll the browser page. Negative deltaY scrolls down (most common), positive scrolls up.',
      parameters: {
        type: 'object',
        properties: {
          deltaY: { type: 'number', description: 'Scroll amount in pixels. -300 = scroll down one "page", 300 = scroll up. Default: -300' },
          x: { type: 'number', description: 'Optional X position to scroll at (default: center)' },
          y: { type: 'number', description: 'Optional Y position to scroll at (default: center)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'computer_open_app',
      description: 'Open an application or file on the Windows desktop (the user\'s real machine), e.g. "notepad", "calc", "explorer", or a full path. Controls the actual OS, not the in-app browser.',
      parameters: {
        type: 'object',
        properties: {
          app: { type: 'string', description: 'Application name or path to open (e.g. "notepad", "C:/path/app.exe")' }
        },
        required: ['app']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'computer_type_text',
      description: 'Type text into whatever window/field currently has focus on the Windows desktop. BLIND action — you cannot see the screen yet, so only use it when you are sure the right field is focused (e.g. right after opening an app). Use computer_press_keys for special keys.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to type at the current cursor' }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'computer_press_keys',
      description: 'Send a keyboard shortcut/key to the focused window on the Windows desktop, in SendKeys format. Examples: "{ENTER}", "{TAB}", "{ESC}", "^s" (Ctrl+S), "^c" (Ctrl+C), "%{F4}" (Alt+F4). BLIND action. Risky combos (Ctrl/Alt, Delete, Alt+F4) always ask for confirmation first.',
      parameters: {
        type: 'object',
        properties: {
          keys: { type: 'string', description: 'Keys in SendKeys format (^ = Ctrl, % = Alt, + = Shift; named keys in braces)' }
        },
        required: ['keys']
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
      description: `Run multiple subtasks in parallel using collaborative agents. Each subtask is a one-shot AI call WITHOUT tools — it reasons over the content you put in its prompt (paste the files/snippets/search results it needs), it does NOT browse/read/edit on its own. Pick a specialized role via "agent". Roles: ${subagentRolesHint()}.`,
      parameters: {
        type: 'object',
        properties: {
          subtasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                prompt: { type: 'string', description: 'The instruction for this agent' },
                agent: { type: 'string', description: 'Optional named role: explorer | planner | reviewer | general (default). Prepends a specialized system prompt.' }
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
  'read_file', 'search_files', 'list_directory', 'web_search', 'fetch_url', 'browser_get_text',
  'browser_get_links', 'browser_get_forms', 'browser_screenshot', 'browser_wait',
  'update_working_memory', 'plan_tasks', 'update_task_status', 'undo_last_write',
  'remember_fact', 'load_skill'
])

export const DANGEROUS_TOOLS = new Set([
  'execute_command', 'write_file', 'edit_file', 'open_file_or_url', 'git_command',
  'computer_open_app', 'computer_type_text', 'computer_press_keys',
  'browser_navigate', 'browser_click', 'browser_type', 'delegate_subtasks',
  // Computer Use — vision-based coordinate interaction
  'browser_click_at', 'browser_type_text', 'browser_key_press', 'browser_scroll',
])
