---
tipo: fix
titulo: Mensagem clara quando o proxy de download está fora do ar
---

Quando o download é roteado por um proxy (ex.: o Agente de Proxy residencial) e
esse proxy está indisponível, o job falhava com um erro técnico cru de "conexão
recusada". Agora a falha traz uma mensagem acionável: avisa que o proxy está
fora do ar e orienta a verificar o Agente de Proxy em Admin → Integrações, ou a
ajustar/remover o proxy para baixar direto pelo servidor.
