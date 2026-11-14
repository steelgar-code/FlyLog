# FlyLog

[English](README.md) · [Українська](README.uk.md)

Diário de voo e gerenciador de frota offline-first para pilotos de drone/VANT. Registre voos, gerencie sua frota e seu estoque de baterias, e acompanhe dados personalizados — tudo funcionando localmente no seu navegador, sem necessidade de servidor.

## Funcionalidades

- **Registro de voos** — registre voos por aeronave com hora de início, hora de término e duração; preencha quaisquer dois campos e o terceiro é calculado automaticamente. Edite qualquer registro salvo depois, caso precise corrigir algo.
- **Gerenciamento de frota e baterias** — drones e baterias ficam em cartões recolhíveis (recolhidos por padrão, expanda para ver estatísticas completas e ações), cada um com status totalmente personalizados que você pode adicionar, remover e recolorir conforme seu fluxo de trabalho.
- **Tempo de vida do drone** — expanda o cartão de um drone para ver as datas/horas do Primeiro Voo e do Último Voo, além do Tempo de Vida entre eles (ex.: "45min" ou "1a 3mes 25d 3h 45min"). O painel "Tempo de vida da frota" no painel principal resume isso em estatísticas de tempo de vida mínimo, médio e máximo de toda a frota (drones sem voos ainda são excluídos).
- **Reordenar seu equipamento** — arraste e solte, ou use os botões de subir/descer, para organizar drones e baterias na ordem que você mais usa. Novos itens vão para o topo, e essa mesma ordem define os menus de Aeronave/Bateria no formulário de Registro de Voo.
- **Campos personalizados** — defina seus próprios campos de registro de voo para capturar o que for importante para sua operação, cada um com seu próprio gráfico de tendência no painel.
- **Gráficos e estatísticas** — o gráfico de Tendência de Horas de Voo alterna entre as visualizações Semanal (8 semanas), Mensal (6 meses) e Últimos 30 Dias.
- **Backup e exportação** — baixe um backup completo em JSON a qualquer momento, além de exportar o diário de voo em CSV com um clique (abre corretamente no Excel). Ao importar um backup, escolha "Substituir" (apaga o que está no dispositivo e usa o backup) ou "Mesclar" (adiciona só o que falta, ignorando duplicados); registros danificados são ignorados e contados. Como tudo fica armazenado no navegador, exportar um backup periodicamente é a única forma de manter seus dados seguros.
- **PWA instalável, 100% offline** — Tailwind, Chart.js e Font Awesome ficam na pasta `vendor/`, então o app não faz nenhuma requisição a terceiros. O service worker salva o app inteiro na primeira visita e o abre a partir dessa cópia, sem esperar pela rede; basta uma visita com internet. Novas versões são baixadas em segundo plano e o aviso "Atualização disponível" oferece recarregar. A linha "Uso offline" na barra lateral mostra o estado: Pronto, Preparando…, Arquivos locais ou Indisponível.
- **Multilíngue** — disponível em inglês, ucraniano e português (BR).
- **Armazenamento somente local** — todos os dados ficam no `localStorage` do seu navegador; nada é enviado a um servidor.

## Uso

O FlyLog é um site estático, sem etapa de build. O `index.html` precisa da pasta `vendor/`, do `sw.js`, do manifest e dos ícones ao lado. Para executá-lo:

1. Abra `index.html` diretamente no navegador (funciona sem internet desde que `vendor/` fique ao lado; nesse caso não há service worker), ou
2. Sirva a pasta com qualquer servidor de arquivos estáticos (ex.: `npx serve .`) e abra no navegador. Uma visita com internet já salva o app para uso offline.
3. Opcionalmente, instale-o como PWA pelo prompt de instalação do navegador.

## Dados e privacidade

Todos os dados de voos e frota são armazenados localmente no seu navegador via `localStorage`. Nada é transmitido a nenhum servidor. Limpar os dados do navegador removerá essas informações, então exporte/faça backup regularmente se depender desses dados.

## Desenvolvimento

Os testes usam Playwright (Chromium): rode `npm install` e depois `npm test`.

Ao adicionar um arquivo à página, liste-o também no `sw.js` para que seja salvo para uso offline (um teste garante isso).

## Licença

MIT — veja [LICENSE](LICENSE).
