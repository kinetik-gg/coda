import { FieldType } from '@prisma/client';
import type { ProjectTemplateId } from '@coda/contracts';

interface TemplateField {
  name: string;
  key: string;
  type: FieldType;
  options?: string[];
}

interface TemplateLevel {
  singularName: string;
  pluralName: string;
  displayPrefix: string;
  fields: TemplateField[];
}

export interface ProjectTemplate {
  id: ProjectTemplateId;
  name: string;
  description: string;
  levels: TemplateLevel[];
}

export const projectTemplates: ProjectTemplate[] = [
  {
    id: 'movie',
    name: 'Movie',
    description: 'Sequences, scenes, and shots for feature or short-form screen stories.',
    levels: [
      {
        singularName: 'Sequence',
        pluralName: 'Sequences',
        displayPrefix: 'SEQ',
        fields: [
          { name: 'Synopsis', key: 'synopsis', type: FieldType.LONG_TEXT },
          {
            name: 'Status',
            key: 'status',
            type: FieldType.ENUM,
            options: ['Planned', 'In progress', 'Complete'],
          },
        ],
      },
      {
        singularName: 'Scene',
        pluralName: 'Scenes',
        displayPrefix: 'SC',
        fields: [
          { name: 'Summary', key: 'summary', type: FieldType.LONG_TEXT },
          { name: 'Location', key: 'location', type: FieldType.TEXT },
          {
            name: 'Time of day',
            key: 'time_of_day',
            type: FieldType.ENUM,
            options: ['Day', 'Night', 'Dawn', 'Dusk', 'Continuous'],
          },
        ],
      },
      {
        singularName: 'Shot',
        pluralName: 'Shots',
        displayPrefix: 'SH',
        fields: [
          { name: 'Description', key: 'description', type: FieldType.LONG_TEXT },
          {
            name: 'Shot size',
            key: 'shot_size',
            type: FieldType.ENUM,
            options: ['Extreme wide', 'Wide', 'Medium', 'Close-up', 'Extreme close-up'],
          },
          { name: 'Duration', key: 'duration', type: FieldType.FLOAT },
          { name: 'Notes', key: 'notes', type: FieldType.LONG_TEXT },
        ],
      },
    ],
  },
  {
    id: 'tv_series',
    name: 'TV Series',
    description: 'Episodes, scenes, and shots for episodic screen stories.',
    levels: [
      {
        singularName: 'Episode',
        pluralName: 'Episodes',
        displayPrefix: 'EP',
        fields: [
          { name: 'Episode number', key: 'episode_number', type: FieldType.INTEGER },
          { name: 'Logline', key: 'logline', type: FieldType.LONG_TEXT },
        ],
      },
      {
        singularName: 'Scene',
        pluralName: 'Scenes',
        displayPrefix: 'SC',
        fields: [
          { name: 'Summary', key: 'summary', type: FieldType.LONG_TEXT },
          { name: 'Location', key: 'location', type: FieldType.TEXT },
          { name: 'Story day', key: 'story_day', type: FieldType.INTEGER },
        ],
      },
      {
        singularName: 'Shot',
        pluralName: 'Shots',
        displayPrefix: 'SH',
        fields: [
          { name: 'Description', key: 'description', type: FieldType.LONG_TEXT },
          { name: 'Duration', key: 'duration', type: FieldType.FLOAT },
          { name: 'Notes', key: 'notes', type: FieldType.LONG_TEXT },
        ],
      },
    ],
  },
  {
    id: 'comic',
    name: 'Comic',
    description: 'Issues, pages, and panels for sequential art breakdowns.',
    levels: [
      {
        singularName: 'Issue',
        pluralName: 'Issues',
        displayPrefix: 'ISS',
        fields: [
          { name: 'Issue number', key: 'issue_number', type: FieldType.INTEGER },
          { name: 'Synopsis', key: 'synopsis', type: FieldType.LONG_TEXT },
        ],
      },
      {
        singularName: 'Page',
        pluralName: 'Pages',
        displayPrefix: 'PG',
        fields: [
          { name: 'Page number', key: 'page_number', type: FieldType.INTEGER },
          { name: 'Notes', key: 'notes', type: FieldType.LONG_TEXT },
        ],
      },
      {
        singularName: 'Panel',
        pluralName: 'Panels',
        displayPrefix: 'PNL',
        fields: [
          { name: 'Description', key: 'description', type: FieldType.LONG_TEXT },
          { name: 'Dialogue', key: 'dialogue', type: FieldType.LONG_TEXT },
          { name: 'Caption', key: 'caption', type: FieldType.LONG_TEXT },
        ],
      },
    ],
  },
];

export function projectTemplate(id: ProjectTemplateId): ProjectTemplate {
  return projectTemplates.find((template) => template.id === id)!;
}
