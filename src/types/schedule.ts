// ─── Scheduled Tasks ────────────────────────────────────────────────
// Cron-like task scheduler. Each task fires a prompt into a new or
// existing conversation on a configurable interval.

export type ScheduleType = 'interval' | 'daily' | 'weekly'

export interface TaskSchedule {
  type: ScheduleType
  /** Minutes between runs (for 'interval') */
  intervalMinutes?: number
  /** HH:MM in local time (for 'daily' / 'weekly') */
  time?: string
  /** 0=Sun … 6=Sat (for 'weekly') */
  dayOfWeek?: number
}

export interface ScheduledTask {
  id: string
  name: string
  prompt: string
  schedule: TaskSchedule
  /** Optional agent profile to use */
  profileId?: string
  enabled: boolean
  /** Epoch ms of last execution */
  lastRun?: number
  /** Epoch ms of next scheduled execution */
  nextRun?: number
  /** Conversation IDs created by this task */
  createdConversationIds: string[]
  createdAt: number
  updatedAt: number
}

/** Storage key */
export const TASKS_STORAGE_KEY = 'openclaude-scheduled-tasks'
