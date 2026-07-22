import { Injectable, ServiceUnavailableException } from '@nestjs/common';

const MAX_CONCURRENT_PROJECT_IMPORTS = 2;

@Injectable()
export class ProjectImportAdmission {
  private active = 0;

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_CONCURRENT_PROJECT_IMPORTS) {
      throw new ServiceUnavailableException('Project import capacity is full; retry later');
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
    }
  }
}
