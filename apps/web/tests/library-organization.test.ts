import { describe, expect, it } from 'bun:test';
import { groupByCaptureWeek, libraryWeekBounds } from '../src/client/lib/library-organization';

describe('libraryWeekBounds', () => {
  it('calcula semana atual de segunda a segunda', () => {
    const result = libraryWeekBounds('this-week', new Date(2026, 6, 29, 15));
    expect(result?.from).toBe(new Date(2026, 6, 27).toISOString());
    expect(result?.to).toBe(new Date(2026, 7, 3).toISOString());
  });

  it('calcula a semana anterior sem sobreposição', () => {
    const result = libraryWeekBounds('previous-week', new Date(2026, 6, 29, 15));
    expect(result?.from).toBe(new Date(2026, 6, 20).toISOString());
    expect(result?.to).toBe(new Date(2026, 6, 27).toISOString());
  });

  it('não adiciona limite temporal para toda a Base de conhecimento', () => {
    expect(libraryWeekBounds('all', new Date(2026, 6, 29))).toBeNull();
  });
});

describe('groupByCaptureWeek', () => {
  it('separa conteúdos por semana e mantém a semana mais recente primeiro', () => {
    const groups = groupByCaptureWeek([
      { id: 'old', createdAt: new Date(2026, 6, 20, 9).toISOString() },
      { id: 'new-a', createdAt: new Date(2026, 6, 28, 9).toISOString() },
      { id: 'new-b', createdAt: new Date(2026, 6, 29, 9).toISOString() },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['new-a', 'new-b']);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(['old']);
  });

  it('ignora datas inválidas sem quebrar a lista', () => {
    expect(groupByCaptureWeek([{ createdAt: 'não-é-data' }])).toEqual([]);
  });
});
