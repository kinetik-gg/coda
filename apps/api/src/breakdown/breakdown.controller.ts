import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createEntityTypeSchema,
  createFieldDefinitionSchema,
  createItemSchema,
  listItemsQuerySchema,
  reorderFieldSchema,
  reorderSchema,
  setFieldValueSchema,
  updateEntityTypeSchema,
  updateFieldDefinitionSchema,
  updateItemSchema,
} from '@coda/contracts';
import { BreakdownService } from './breakdown.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Controller('api/v1/projects/:projectId')
export class BreakdownController {
  constructor(
    private readonly breakdown: BreakdownService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Post('entity-types')
  async addType(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const entityType = await this.breakdown.addEntityType(
      request.user!.id,
      projectId,
      createEntityTypeSchema.parse(body),
    );
    await this.realtime.invalidateProject(projectId, 'entity-types', [entityType.id]);
    return {
      data: entityType,
    };
  }

  @Patch('entity-types/:entityTypeId')
  async updateType(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('entityTypeId') id: string,
    @Body() body: unknown,
  ) {
    const entityType = await this.breakdown.updateEntityType(
      request.user!.id,
      projectId,
      id,
      updateEntityTypeSchema.parse(body),
    );
    await this.realtime.invalidateProject(projectId, 'entity-types', [id]);
    return {
      data: entityType,
    };
  }

  @Delete('entity-types/:entityTypeId')
  async deleteType(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('entityTypeId') id: string,
  ) {
    const result = await this.breakdown.removeDeepestEntityType(request.user!.id, projectId, id);
    await this.realtime.invalidateProject(projectId, 'entity-types', [id]);
    return { data: result };
  }

  @Get('items')
  async items(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Query() query: unknown,
  ) {
    const result = await this.breakdown.listItems(
      request.user!.id,
      projectId,
      listItemsQuerySchema.parse(query),
    );
    return { data: result.data, meta: { nextCursor: result.nextCursor } };
  }

  @Post('items')
  async createItem(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const item = await this.breakdown.createItem(
      request.user!.id,
      projectId,
      createItemSchema.parse(body),
    );
    await this.realtime.invalidateProject(projectId, 'items', [item.id]);
    return {
      data: item,
    };
  }

  @Patch('items/:itemId')
  async updateItem(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('itemId') id: string,
    @Body() body: unknown,
  ) {
    const item = await this.breakdown.updateItem(
      request.user!.id,
      projectId,
      id,
      updateItemSchema.parse(body),
    );
    await this.realtime.invalidateProject(projectId, 'items', [id]);
    return {
      data: item,
    };
  }

  @Patch('items/:itemId/reorder')
  async reorderItem(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('itemId') id: string,
    @Body() body: unknown,
  ) {
    const item = await this.breakdown.reorderItem(
      request.user!.id,
      projectId,
      id,
      reorderSchema.parse(body),
    );
    await this.realtime.invalidateProject(projectId, 'items', [id]);
    return {
      data: item,
    };
  }

  @Get('entity-types/:entityTypeId/fields')
  async fields(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('entityTypeId') entityTypeId: string,
  ) {
    return { data: await this.breakdown.listFields(request.user!.id, projectId, entityTypeId) };
  }

  @Post('fields')
  async createField(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const field = await this.breakdown.createField(
      request.user!.id,
      projectId,
      createFieldDefinitionSchema.parse(body),
    );
    await this.realtime.invalidateProject(projectId, 'fields', [field.id]);
    return {
      data: field,
    };
  }

  @Get('fields/:fieldId')
  async field(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('fieldId') id: string,
  ) {
    return { data: await this.breakdown.getField(request.user!.id, projectId, id) };
  }

  @Patch('fields/:fieldId')
  async updateField(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('fieldId') id: string,
    @Body() body: unknown,
  ) {
    const field = await this.breakdown.updateField(
      request.user!.id,
      projectId,
      id,
      updateFieldDefinitionSchema.parse(body),
    );
    await this.realtime.invalidateProject(projectId, 'fields', [id]);
    return { data: field };
  }

  @Patch('fields/:fieldId/reorder')
  async reorderField(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('fieldId') id: string,
    @Body() body: unknown,
  ) {
    const field = await this.breakdown.reorderField(
      request.user!.id,
      projectId,
      id,
      reorderFieldSchema.parse(body),
    );
    await this.realtime.invalidateProject(projectId, 'fields', [id]);
    return {
      data: field,
    };
  }

  @Put('items/:itemId/fields/:fieldId')
  async setValue(
    @Req() request: Request,
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
    @Param('fieldId') fieldId: string,
    @Body() body: unknown,
  ) {
    const item = await this.breakdown.setFieldValue(
      request.user!.id,
      projectId,
      itemId,
      fieldId,
      setFieldValueSchema.parse(body),
    );
    await this.realtime.invalidateProject(projectId, 'items', [itemId]);
    return {
      data: item,
    };
  }
}
