# 029 — Dedup de rolling captions nas legendas VTT

## Contexto

Legendas automáticas do YouTube baixadas via yt-dlp (formato VTT) usam
"rolling captions": cada cue repete a(s) linha(s) do cue anterior e acrescenta
a nova. O parser `parse_vtt_or_srt` emitia cada cue verbatim, então o texto
final saía com cada linha duplicada 2-3x e com "sequência" embaralhada —
observado em prod (transcrição do vídeo do CNPJ alfanumérico):

```
CNPJ terá letras e números a partir de

CNPJ terá letras e números a partir de julho, mês que vem, cara. Então, você

julho, mês que vem, cara. Então, você
```

Afeta busca FTS (rank inflado), leitura, contexto do agente e custo de tokens.
O caminho via youtube-transcript-api não é afetado (snippets sem rolling).

## Requisitos (EARS)

- **Quando** parsear VTT/SRT, **o sistema deve** descartar do início de cada
  cue o maior bloco de linhas que repete o final do cue anterior
  (overlap sufixo→prefixo, comparação por linha exata pós-limpeza de tags).
- **Se** um cue for 100% repetição do anterior, **o sistema deve** não emitir
  segmento para ele.
- **Enquanto** a legenda não tiver rolling (SRT normal, legendas manuais),
  **o sistema deve** produzir exatamente o mesmo resultado de antes.
- **Quando** o reparo das transcrições existentes rodar
  (`python -m src.repair_rolling`), **o sistema deve** re-obter a legenda,
  re-parsear e atualizar a MESMA row (`plainText`) e o MESMO objeto S3
  (`mdPath`) — preservando id e vínculos (notas, Brain); o trigger de FTS
  recalcula o `searchVector`.
- **Se** a legenda não puder ser re-baixada, **o reparo deve** pular a
  transcrição e reportar (re-executável).

## Critérios de aceite

1. Amostra rolling real → texto sem duplicação, timestamps preservados.
2. Cues idênticos consecutivos → um único segmento.
3. Amostras não-rolling existentes nos testes → output idêntico ao atual.
4. Reparo com `--dry-run` relata sem alterar nada.
