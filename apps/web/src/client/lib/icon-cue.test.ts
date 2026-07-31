import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  ICON_CUE_DURATION,
  ICON_CUE_HOLD_MS,
  ICON_CUE_PAGE_DELAY_MS,
  ICON_CUE_PANEL_DELAY_MS,
  ICON_CUE_STAGGER_MS,
  iconCueSchedule,
} from './icon-cue';

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('agenda das deixas de ícone', () => {
  test('escalona os ícones em cascata a partir do atraso base', () => {
    const schedule = iconCueSchedule(3, 100);

    expect(schedule.map((step) => step.startAt)).toEqual([
      100,
      100 + ICON_CUE_STAGGER_MS,
      100 + 2 * ICON_CUE_STAGGER_MS,
    ]);
  });

  test('cada ícone volta ao repouso depois de completar o desenho', () => {
    for (const step of iconCueSchedule(4)) {
      expect(step.stopAt - step.startAt).toBe(ICON_CUE_HOLD_MS);
      // O pacote roda as transições internas em até 0.9x `duration`; o hold
      // precisa cobrir isso com folga, senão o ícone corta no meio.
      expect(step.stopAt - step.startAt).toBeGreaterThan(ICON_CUE_DURATION * 1000);
    }
  });

  test('lida com grupos vazios sem agendar nada', () => {
    expect(iconCueSchedule(0)).toEqual([]);
    expect(iconCueSchedule(-3)).toEqual([]);
  });

  test('esvazia a fila de timers no lugar, sem trocar o array', () => {
    // A limpeza do unmount captura o array uma vez. Se `playCue` reatribuísse
    // `timers.current`, a limpeza seguraria um array velho e os timers vivos
    // vazariam — disparando animação em ícone já desmontado ao alternar a
    // sidebar no meio da deixa.
    const iconCue = read('./icon-cue.ts');

    expect(iconCue).toContain('timers.current.length = 0');
    expect(iconCue).not.toContain('timers.current = []');
  });

  test('mantém o gesto curto o bastante para ler como pontuação', () => {
    // Padrão do pacote é 1s — uma deixa mais longa que isso vira performance.
    expect(ICON_CUE_DURATION).toBeLessThan(1);
    // Um pouco mais apertado que o stagger de 55ms do PageShell (alvos menores).
    expect(ICON_CUE_STAGGER_MS).toBeLessThan(55);
    // Uma varredura de 12 itens da sidebar não pode se arrastar.
    const sweep = iconCueSchedule(12, ICON_CUE_PANEL_DELAY_MS);
    expect(sweep.at(-1)?.startAt).toBeLessThan(1000);
  });
});

describe('onde as deixas de ícone tocam', () => {
  test('a página pontua só o ícone do cabeçalho, depois da timeline subir', () => {
    const pageShell = read('../components/ui/page-shell.tsx');

    expect(pageShell).toContain('playCue(ICON_CUE_PAGE_DELAY_MS)');
    expect(pageShell).toContain("registerIcon('eyebrow')");
    // Um único ícone por página — nada de animar a tela inteira a cada rota.
    expect(pageShell.match(/registerIcon\(/g)?.length).toBe(1);
    // Espera o cabeçalho terminar de subir (0.38s de duration na timeline).
    expect(ICON_CUE_PAGE_DELAY_MS).toBeGreaterThan(0);
  });

  test('a sidebar só dispara quando o usuário abre ou fecha o painel', () => {
    const sidebar = read('../components/layout/sidebar.tsx');

    expect(sidebar).toContain('const cueOnMount = previousCollapsed.current !== collapsed');
    expect(sidebar).toContain('if (cueOnMount) playCue(ICON_CUE_PANEL_DELAY_MS)');
    // Rail (colapsada) e nav (expandida) — os dois lados do toggle.
    expect(sidebar.match(/if \(cueOnMount\) playCue\(/g)?.length).toBe(2);
  });

  test('movimento reduzido desliga as deixas na origem', () => {
    const iconCue = read('./icon-cue.ts');
    const pageShell = read('../components/ui/page-shell.tsx');
    const sidebar = read('../components/layout/sidebar.tsx');

    expect(iconCue).toContain('if (!enabled) return');
    expect(pageShell).toContain('useIconCueGroup(!reduceMotion)');
    expect(sidebar.match(/useIconCueGroup\(!reduceMotion\)/g)?.length).toBe(2);
  });

  test('os ícones expõem o handle de animação sem perder o hover', () => {
    const icons = read('../components/ui/icons.ts');

    expect(icons).toContain('useImperativeHandle');
    expect(icons).toContain('startAnimation');
    // Anexar ref faz o pacote delegar o hover — reproduzimos os handlers.
    expect(icons).toContain('onMouseEnter');
    expect(icons).toContain('onMouseLeave');
    expect(icons).toContain('shouldAnimateDecoration(reduceMotion, isAnimated)');
  });
});
