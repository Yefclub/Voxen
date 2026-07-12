import { describe, expect, it } from 'bun:test';
import {
  filterFoldersByQuery,
  LIBRARY_FOLDER_CHIP_LIMIT,
  splitFolderChips,
} from '../src/client/lib/library-folders';

interface FolderFixture {
  id: string;
  name: string;
}

function makeFolders(count: number): FolderFixture[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `folder-${i}`,
    name: `Pasta ${i}`,
  }));
}

describe('splitFolderChips', () => {
  it('sem overflow quando há menos pastas que o limite', () => {
    const folders = makeFolders(3);
    const { visible, overflow } = splitFolderChips(folders, 6);
    expect(visible).toEqual(folders);
    expect(overflow).toEqual([]);
  });

  it('sem overflow quando o total é exatamente igual ao limite', () => {
    const folders = makeFolders(6);
    const { visible, overflow } = splitFolderChips(folders, 6);
    expect(visible).toEqual(folders);
    expect(overflow).toEqual([]);
  });

  it('corta no limite e conta o overflow corretamente quando há mais pastas que o limite', () => {
    const folders = makeFolders(10);
    const { visible, overflow } = splitFolderChips(folders, 6);
    expect(visible).toEqual(folders.slice(0, 6));
    expect(overflow).toEqual(folders.slice(6));
    expect(overflow.length).toBe(4);
  });

  it('lista vazia retorna visible e overflow vazios', () => {
    const { visible, overflow } = splitFolderChips([], 6);
    expect(visible).toEqual([]);
    expect(overflow).toEqual([]);
  });

  it('preserva a ordem original das pastas (não reordena)', () => {
    const folders = makeFolders(8);
    const { visible, overflow } = splitFolderChips(folders, 6);
    expect(visible.map((f) => f.id)).toEqual([
      'folder-0',
      'folder-1',
      'folder-2',
      'folder-3',
      'folder-4',
      'folder-5',
    ]);
    expect(overflow.map((f) => f.id)).toEqual(['folder-6', 'folder-7']);
  });

  it('trata limite zero jogando tudo para overflow', () => {
    const folders = makeFolders(2);
    const { visible, overflow } = splitFolderChips(folders, 0);
    expect(visible).toEqual([]);
    expect(overflow).toEqual(folders);
  });

  it('trata limite negativo como zero', () => {
    const folders = makeFolders(2);
    const { visible, overflow } = splitFolderChips(folders, -3);
    expect(visible).toEqual([]);
    expect(overflow).toEqual(folders);
  });

  it('LIBRARY_FOLDER_CHIP_LIMIT é um inteiro positivo razoável', () => {
    expect(Number.isInteger(LIBRARY_FOLDER_CHIP_LIMIT)).toBe(true);
    expect(LIBRARY_FOLDER_CHIP_LIMIT).toBeGreaterThan(0);
  });
});

describe('filterFoldersByQuery', () => {
  const produtividade: FolderFixture = { id: '1', name: 'Produtividade' };
  const machineLearning: FolderFixture = { id: '2', name: 'Machine Learning' };
  const historiaDoBrasil: FolderFixture = { id: '3', name: 'História do Brasil' };
  const ia: FolderFixture = { id: '4', name: 'IA' };
  const folders: FolderFixture[] = [produtividade, machineLearning, historiaDoBrasil, ia];

  it('query vazia retorna todas as pastas', () => {
    expect(filterFoldersByQuery(folders, '')).toEqual(folders);
  });

  it('query só com espaços é tratada como vazia', () => {
    expect(filterFoldersByQuery(folders, '   ')).toEqual(folders);
  });

  it('filtra por substring, sem diferenciar maiúsculas/minúsculas', () => {
    expect(filterFoldersByQuery(folders, 'machine')).toEqual([machineLearning]);
    expect(filterFoldersByQuery(folders, 'MACHINE')).toEqual([machineLearning]);
    expect(filterFoldersByQuery(folders, 'produ')).toEqual([produtividade]);
  });

  it('ignora espaços nas pontas da query', () => {
    expect(filterFoldersByQuery(folders, '  brasil  ')).toEqual([historiaDoBrasil]);
  });

  it('retorna lista vazia quando nada bate com a query', () => {
    expect(filterFoldersByQuery(folders, 'inexistente')).toEqual([]);
  });

  it('lista de pastas vazia retorna vazio independente da query', () => {
    expect(filterFoldersByQuery([], 'qualquer')).toEqual([]);
  });
});
