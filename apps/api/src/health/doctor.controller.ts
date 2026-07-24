import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DoctorService } from './doctor.service';

@Controller('api/v1/instance/doctor')
export class DoctorController {
  constructor(private readonly doctor: DoctorService) {}

  @Get()
  async report(@Req() request: Request) {
    return { data: await this.doctor.report(request.user!.id) };
  }
}
