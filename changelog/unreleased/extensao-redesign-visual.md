---
tipo: ui
titulo: Extensão de browser redesenhada com a identidade visual do Voxen
---

O popup e a página de opções da extensão de browser agora usam os mesmos
tokens de cor e a mesma tipografia do Voxen web (Bricolage Grotesque + Inter,
temas padrão/zinc/emerald/light) — antes a extensão tinha uma paleta
verde/indigo própria, sempre escura, desconectada do resto do produto.

- **Tema segue a instância conectada**: se você já tem um tema escolhido no
  Voxen (`Conta → Aparência`), a extensão aplica o mesmo tema assim que
  detecta a instância — tanto no popup quanto na página de opções. Sem
  instância conectada ainda, ela segue o esquema claro/escuro do sistema
  operacional.
- **Uma única tela de conexão**: a página de opções (`chrome-extension://.../options.html`)
  passa a ser a única superfície onde a extensão se conecta a uma instância
  Voxen. O popup não reimplementa mais esse formulário — quando ainda não há
  instância conectada, ele mostra um estado vazio com um botão que abre as
  opções, eliminando a duplicação de fluxo entre popup e opções.
- **Progresso mostra a etapa real**: enquanto um job está processando, o
  popup exibe a etapa atual (baixando, transcrevendo, gerando resumo…) em vez
  de um "Processando…" genérico, sempre que o status do job traz essa
  informação.
- Todos os estados existentes (detecção de instância, envio de aba,
  progresso, resultado com resumo, ações pós-envio) continuam disponíveis —
  nenhuma capacidade foi removida, só reorganizada.
