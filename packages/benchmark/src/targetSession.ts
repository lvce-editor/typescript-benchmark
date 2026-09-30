import type { CDPSession } from 'playwright'

interface Message {
  readonly id: number
  readonly result?: unknown
  readonly error?: unknown
}

interface Pending {
  readonly resolve: (value: any) => void
  readonly reject: (reason: unknown) => void
  readonly timer: NodeJS.Timeout
}

export class TargetSession {
  private nextId = 0
  private readonly pending = new Map<number, Pending>()
  private readonly listener: (event: { sessionId: string; message: string }) => void

  constructor(private readonly root: CDPSession, private readonly sessionId: string) {
    this.listener = (event) => {
      if (event.sessionId !== this.sessionId) return
      const message = JSON.parse(event.message) as Message
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
      else pending.resolve(message.result)
    }
    root.on('Target.receivedMessageFromTarget', this.listener)
  }

  async send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 10000)
      this.pending.set(id, { resolve, reject, timer })
      void this.root.send('Target.sendMessageToTarget', {
        sessionId: this.sessionId,
        message: JSON.stringify({ id, method, params }),
      }).catch((error) => {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  async close(): Promise<void> {
    this.root.off('Target.receivedMessageFromTarget', this.listener)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('CDP target session closed'))
    }
    this.pending.clear()
    await this.root.send('Target.detachFromTarget', { sessionId: this.sessionId }).catch(() => undefined)
  }
}
