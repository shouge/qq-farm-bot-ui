import type { ILogger } from '../../domain/ports/ILogger';
import type { AutomationConfig } from '../../domain/value-objects/AutomationConfig';

export interface DailyRoutineResult {
  success: boolean;
  skipped?: boolean;
  error?: string;
}

export interface IDailyRoutine {
  readonly key: string;
  isEnabled(config: AutomationConfig): boolean;
  perform(): Promise<DailyRoutineResult>;
}

export class DailyRoutineOrchestrator {
  constructor(
    private readonly routines: IDailyRoutine[],
    private readonly logger: ILogger
  ) {}

  async runAll(force = false): Promise<void> {
    for (const routine of this.routines) {
      try {
        if (force || routine.isEnabled({} as AutomationConfig)) {
          const result = await routine.perform();
          if (!result.success && result.error) {
            this.logger.warn(`每日任务 ${routine.key} 失败: ${result.error}`, { module: 'daily', event: routine.key });
          }
        }
      } catch (e: any) {
        this.logger.warn(`每日任务 ${routine.key} 异常: ${e?.message || ''}`, { module: 'daily', event: routine.key });
      }
    }
  }
}
