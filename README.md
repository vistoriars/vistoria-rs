# Vistoria RS

App de vistoria e revistoria de imóveis.

- **Agenda** com calendário colorido (vistoria em vermelho, revistoria em azul, concluídas em cinza) e botão para iniciar o relatório do agendamento.
- **Relatórios** com fotos marcadas, frases rápidas que aprendem com o uso e PDF no padrão Vistoria RS, salvo no Google Drive em `Vistorias / <Condomínio> /`.
- **Status** de cada serviço: Agendado → Em andamento → PDF gerado → Enviado ao cliente (+ Revistoria agendada).
- **Financeiro**: cobrado, recebido, a receber, gráfico dos últimos 6 meses, cobrança pelo WhatsApp e exportação para planilha Google.
- **Clientes**, **construtoras e condomínios**, **indicadores por construtora**.

Dados: fotos e rascunhos ficam só no aparelho; agenda, clientes, valores e ajustes ficam também no Drive (`_dados-vistoria-rs.json`) para sincronizar celular e computador. Permissão `drive.file`: o app só vê o que ele cria.

Configuração: cole o Client ID do Google em `config.js` ou em Mais → Ajustes.
Atualização: suba os arquivos novos e aumente `VERSION` em `sw.js`.
