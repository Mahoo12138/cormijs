export interface MetreEvent {
  name: string
  timestamp?: number
  payload: any
}

export interface IStorage {
  save(e: MetreEvent): Promise<void>
}

export interface IMetry {
  record(e: MetreEvent): void
  recordAsync(e: MetreEvent): Promise<boolean>
  flush(): Promise<void>
}

interface QueuedEvent {
  event: MetreEvent
  tried: number
  status: 'queued' | 'sending' | 'sent'
  promise?: Promise<void>
}

class NoopStorage implements IStorage {
  async save(_e: MetreEvent): Promise<void> {}
}

export const noopStorage: IStorage = new NoopStorage()

/**
 * Telemetry with a pluggable storage (`modifyTelemetryStorage`). Failed saves
 * are retried up to three times. Nothing is sent anywhere by default.
 */
export class Telemetry implements IMetry {
  private queuedEvents: QueuedEvent[] = []
  private storage: IStorage = noopStorage
  private timer: ReturnType<typeof setTimeout> | undefined

  prefixWith(prefix: string): IMetry {
    const upstream = this
    return {
      record({ name, ...rest }) {
        upstream.record({ name: `${prefix}:${name}`, ...rest })
      },
      flush() {
        return upstream.flush()
      },
      recordAsync({ name, ...rest }) {
        return upstream.recordAsync({ name: `${prefix}:${name}`, ...rest })
      },
    }
  }

  useStorage(storage: IStorage) {
    this.storage = storage
  }

  record(e: MetreEvent) {
    this.storage.save(this.addTimeStamp(e)).catch(() => {
      this.queuedEvents.push({ event: e, tried: 1, status: 'queued' })
      this.scheduleFlush()
    })
  }

  async recordAsync(e: MetreEvent): Promise<boolean> {
    try {
      await this.storage.save(this.addTimeStamp(e))
      return true
    } catch {
      return false
    }
  }

  async flush() {
    const events = this.unfinishedEvents().map((e) => {
      if (e.status === 'queued') {
        e.status = 'sending'
        e.tried++
        e.promise = this.storage.save(e.event).then(
          () => { e.status = 'sent' },
          () => { e.status = 'queued' },
        )
      }
      return e
    })
    this.queuedEvents = events
    await Promise.all(events.map(({ promise }) => promise))
  }

  /** Cancel the pending retry, so that the process can exit. */
  dispose() {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private scheduleFlush() {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush().then(this.afterFlush, this.afterFlush)
    }, 5000)
    this.timer.unref?.()
  }

  private afterFlush = () => {
    if (this.unfinishedEvents().length) {
      this.scheduleFlush()
    } else {
      this.queuedEvents = []
    }
  }

  private unfinishedEvents() {
    return this.queuedEvents.filter(e => e.status !== 'sent' && e.tried < 3)
  }

  private addTimeStamp(e: MetreEvent) {
    e.timestamp ||= Date.now()
    return e
  }
}
