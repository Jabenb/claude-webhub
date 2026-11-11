/** One thing the person did on a mod's page, as the page passed it to `hub.send`. */
export type WebhubAction = {
  id: number
  at: number
  data: unknown
}

/**
 * Whom a page belongs to. `session` (the default): this session alone, listed under its name. `project`: the project the
 * session runs in (its git root, else its folder); every session of the project with the mod listens to the one page,
 * and a press goes to the session the page sends it to, by default the live one the person wrote in last.
 * Pass the same scope to every call for the page: a call without one means the session's own page.
 */
export type WebhubScope = 'session' | 'project'

export type WebhubPageArgs = {
  /** The calling mod's name (letters, digits, `.`, `_`, `-`): the page's address is `/p/<mod>/<session or project key>`. */
  mod: string
  scope?: WebhubScope
  /** The page's name in the hub's list. */
  title: string
  /** The mod's own page, whole; it loads `/hub.js` for `hub.onState` and `hub.send`. */
  html: string
  /** One character or an emoji shown beside the title; without it, the title's first letter. */
  icon?: string
}

export type WebhubPageResult = {
  isUp: boolean
  /** The address to open in the person's browser. */
  url: string
}

export type WebhubPushArgs = {
  mod: string
  scope?: WebhubScope
  /** Any JSON: every open tab of the page gets it at once through `hub.onState`. */
  state: unknown
  /** How many things on the page wait for the person; shown beside the page in the hub's list. */
  badge?: number
}

export type WebhubPullArgs = {
  mod: string
  scope?: WebhubScope
  /** Names one load of the calling mod: the hub hands the page's actions to the newest one only. */
  listener: string
  /** The first pull of this load: it takes the page over from the load before. */
  isFirst?: boolean
  /** How long to wait for an action, 8 s at most. */
  waitMs?: number
}

export type WebhubPullResult = {
  isUp: boolean
  /** A newer load of the mod took the page over: stop pulling. */
  isStale: boolean
  /** False after the hub lost the page: register it and push its state again. */
  isRegistered: boolean
  /** The actions since the pull before; calling `pull` again says these were handled. */
  actions: WebhubAction[]
}

export type Webhub = {
  /** Registers the mod's page for this session (again to replace it) and starts the hub server when it is not running. */
  page: (args: WebhubPageArgs) => Promise<WebhubPageResult>
  push: (args: WebhubPushArgs) => Promise<{ isUp: boolean }>
  read: (args: { mod: string; scope?: WebhubScope }) => Promise<{ isUp: boolean; state: unknown }>
  pull: (args: WebhubPullArgs) => Promise<WebhubPullResult>
}

declare module 'claude-code' {
  interface EngineInterface {
    webhub: Webhub
  }
}
