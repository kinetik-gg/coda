import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { parseFountain } from '../parser';
import {
  exportFinalDraft,
  importFinalDraft,
  MAX_FDX_BYTES,
  MAX_FDX_ELEMENT_COUNT,
  MAX_FDX_ELEMENT_DEPTH,
} from './fdx';
import { ScreenplayInterchangeError } from './types';

const COMPLETE_FDX = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
    <Paragraph Type="Scene Heading" Number="12"><Text>EXT. CAFÉ - NIGHT</Text></Paragraph>
    <Paragraph Type="Action"><Text>Rain &amp; wind.</Text><Text> Hard.</Text></Paragraph>
    <Paragraph Type="Character"><Text>RILEY (V.O.)</Text></Paragraph>
    <Paragraph Type="Parenthetical"><Text>quietly</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>We should go &lt;now&gt;.</Text></Paragraph>
    <Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>
    <Paragraph Type="Action" StartsNewPage="Yes"><Text>Morning.</Text></Paragraph>
  </Content>
  <TitlePage>
    <Content>
      <Paragraph Type="Title"><Text>Weather &amp; Light</Text></Paragraph>
      <Paragraph Type="Author"><Text>Ada Writer</Text></Paragraph>
      <Paragraph Type="Contact"><Text>ada@example.test</Text></Paragraph>
    </Content>
  </TitlePage>
</FinalDraft>`;

describe('Final Draft import', () => {
  it('rejects oversized input before XML parsing', () => {
    expect(() => importFinalDraft(new Uint8Array(MAX_FDX_BYTES + 1))).toThrowError(
      expect.objectContaining({ code: 'INPUT_TOO_LARGE' }),
    );
  });

  it('rejects XML with excessive element depth before DOM construction', () => {
    const nested = '<Block>'.repeat(MAX_FDX_ELEMENT_DEPTH + 1);
    const closing = '</Block>'.repeat(MAX_FDX_ELEMENT_DEPTH + 1);
    expect(() => importFinalDraft(`<FinalDraft>${nested}${closing}</FinalDraft>`)).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_LIMIT' }),
    );
  });

  it('rejects XML with excessive element count before DOM construction', () => {
    const elements = '<Paragraph/>'.repeat(MAX_FDX_ELEMENT_COUNT);
    expect(() =>
      importFinalDraft(`<FinalDraft><Content>${elements}</Content></FinalDraft>`),
    ).toThrowError(expect.objectContaining({ code: 'RESOURCE_LIMIT' }));
  });

  it('handles markup delimiters inside comments, CDATA, processing instructions, and attributes', () => {
    const source = `<?xml version="1.0"?>
      <!-- <Paragraph> is not an element -->
      <FinalDraft><Content><![CDATA[<Paragraph>]]><Paragraph Type="Action" Note=">">
      <Text>Safe.</Text></Paragraph></Content></FinalDraft>`;
    expect(importFinalDraft(source).fountain).toContain('!Safe.');
  });

  it('preserves representable screenplay structure and decoded XML text', () => {
    const result = importFinalDraft(COMPLETE_FDX);
    expect(result).toMatchObject({ sourceFormat: 'final-draft', fidelity: 'lossy' });
    expect(result.fountain).toContain('Title: Weather & Light');
    expect(result.fountain).toContain('EXT. CAFÉ - NIGHT #12#');
    expect(result.fountain).toContain('!Rain & wind. Hard.');
    expect(result.fountain).toContain('RILEY (V.O.)\n(quietly)\nWe should go <now>.');
    expect(result.fountain).toContain('CUT TO:');
    expect(result.fountain).toContain('===\n\n!Morning.');

    const parsed = parseFountain(result.fountain);
    expect(parsed.elements.some((element) => element.kind === 'page_break')).toBe(true);
    expect(parsed.elements).toContainEqual(
      expect.objectContaining({ kind: 'character', name: 'RILEY', extension: '(V.O.)' }),
    );
  });

  it('maps the second cue in a DualDialogue container to Fountain dual dialogue', () => {
    const result = importFinalDraft(`<FinalDraft><Content><DualDialogue>
      <Paragraph Type="Character"><Text>ONE</Text></Paragraph>
      <Paragraph Type="Dialogue"><Text>First.</Text></Paragraph>
      <Paragraph Type="Character"><Text>Two</Text></Paragraph>
      <Paragraph Type="Dialogue"><Text>Second.</Text></Paragraph>
    </DualDialogue></Content></FinalDraft>`);
    expect(result.fountain).toContain('@Two^\nSecond.');
    expect(result.warnings).toContain(
      'Dual dialogue was preserved as Fountain dual-dialogue markup; exact column layout may differ.',
    );
  });

  it('imports unknown paragraphs as action with an explicit warning', () => {
    const result = importFinalDraft(
      '<FinalDraft><Content><Paragraph Type="Custom"><Text>Unknown &amp; safe</Text></Paragraph></Content></FinalDraft>',
    );
    expect(result.fountain).toBe('!Unknown & safe\n');
    expect(result.warnings[0]).toContain('imported as action');
  });

  it('keeps screenplay-looking lines inside FDX action as action', () => {
    const result = importFinalDraft(
      '<FinalDraft><Content><Paragraph Type="Action"><Text>First line.\nINT. NOT A HEADING\nCUT TO:</Text></Paragraph></Content></FinalDraft>',
    );
    const semantic = parseFountain(result.fountain).elements.filter(
      (element) => element.kind !== 'separator',
    );
    expect(result.fountain).toContain('!First line.\n\n!INT. NOT A HEADING\n\n!CUT TO:');
    expect(semantic.slice(0, 2)).toEqual([
      expect.objectContaining({ kind: 'action', text: 'First line.' }),
      expect.objectContaining({ kind: 'action', text: 'INT. NOT A HEADING' }),
    ]);
  });

  it('does not attach malformed orphan dialogue to the preceding action', () => {
    const result = importFinalDraft(
      '<FinalDraft><Content><Paragraph Type="Action"><Text>Before.</Text></Paragraph><Paragraph Type="Dialogue"><Text>Orphan.</Text></Paragraph></Content></FinalDraft>',
    );
    expect(result.fountain).toBe('!Before.\n\n!Orphan.\n');
    expect(result.warnings).toContain('Dialogue without a character cue was imported as action.');
  });

  it.each([
    ['<FinalDraft><Content></FinalDraft>', 'MALFORMED_XML'],
    ['<Other><Content/></Other>', 'INVALID_FDX'],
    ['<FinalDraft/>', 'INVALID_FDX'],
    [
      '<!DOCTYPE FinalDraft [<!ENTITY x "unsafe">]><FinalDraft><Content/></FinalDraft>',
      'UNSAFE_XML',
    ],
  ])('rejects invalid input with typed error %s', (source, code) => {
    expect.assertions(2);
    try {
      importFinalDraft(source);
    } catch (error) {
      expect(error).toBeInstanceOf(ScreenplayInterchangeError);
      expect((error as ScreenplayInterchangeError).code).toBe(code);
    }
  });
});

describe('Final Draft export', () => {
  it('creates well-formed FDX and round-trips the supported screenplay structure', () => {
    const source = `Title: A & B
Author: Ada <Writer>

INT./EXT. CAR - NIGHT #7#

!Rain & wind scrape the windows.

RILEY (O.S.)
(low)
Drive.

>SMASH TO:

===

.A FORCED PLACE`;
    const result = exportFinalDraft(source);
    expect(result).toMatchObject({
      targetFormat: 'final-draft',
      suggestedExtension: '.fdx',
      mimeType: 'application/xml',
      fidelity: 'lossy',
    });
    expect(result.content).toContain('A &amp; B');
    expect(result.content).toContain('Ada &lt;Writer&gt;');

    const xml = new DOMParser().parseFromString(result.content, 'application/xml');
    expect(xml.documentElement?.localName).toBe('FinalDraft');
    expect(xml.getElementsByTagName('Paragraph').length).toBeGreaterThan(5);

    const roundTrip = parseFountain(importFinalDraft(result.content).fountain);
    expect(roundTrip.elements).toContainEqual(
      expect.objectContaining({
        kind: 'scene_heading',
        text: 'INT./EXT. CAR - NIGHT',
        sceneNumber: '7',
      }),
    );
    expect(roundTrip.elements).toContainEqual(
      expect.objectContaining({ kind: 'character', name: 'RILEY', extension: '(O.S.)' }),
    );
    expect(roundTrip.elements.some((element) => element.kind === 'parenthetical')).toBe(true);
    expect(roundTrip.elements.some((element) => element.kind === 'page_break')).toBe(true);
  });

  it('reports Fountain-only structures that cannot be represented', () => {
    const result = exportFinalDraft('# Act one\n\n= A secret\n\n[[note]]\n\n/*cut*/');
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('section'),
        expect.stringContaining('synopsis'),
        expect.stringContaining('note'),
        expect.stringContaining('boneyard'),
      ]),
    );
  });

  it('returns a typed serialization failure for illegal XML characters', () => {
    expect(() => exportFinalDraft('!bad\u0001text')).toThrowError(
      expect.objectContaining({ code: 'SERIALIZATION_FAILED' }),
    );
  });
});
