# Benchmarks de Performance - Protocolo Inteligente v2.9

Este documento define os Indicadores Chave de Performance (KPIs) para as operações mais críticas do sistema. O objetivo é garantir uma experiência de usuário fluida e responsiva, mesmo com um grande volume de dados.

## Metodologia

- **Ferramenta:** `performance.now()` da Web API para medições de alta precisão em milissegundos (ms).
- **Ambiente:** Os testes devem ser executados em um dispositivo alvo representativo (tablet de médio desempenho, sem o console de desenvolvedor aberto para resultados mais realistas).
- **Serviço:** Um `BenchmarkService` centralizado será responsável por iniciar, parar e registrar os tempos.

---

## KPIs Críticos

### 1. Tempo de Inicialização do App (T-I)

- **Ação:** Desde a abertura do aplicativo (ícone PWA) até a exibição e interatividade do Dashboard.
- **Medição:** `performance.now()` no início do `bootstrapApplication` até o momento em que `db.initialized()` se torna `true`.
- **Meta:** **< 2.5 segundos**
- **Teste de Estresse:** Com o banco de dados local populado com 1.000 encomendas e 500 moradores.

### 2. Processamento do Scanner OCR (T-OCR)

- **Ação:** Desde o clique no botão de captura da foto da etiqueta até o retorno do texto processado pelo Tesseract.js.
- **Medição:** `performance.now()` no início do método `scanService.processOCR()` até a sua conclusão (bloco `finally`).
- **Meta:** **< 1.5 segundos** (para uma imagem nítida em boas condições de iluminação).
- **Teste de Estresse:** Imagens com baixa luminosidade, levemente desfocadas ou com reflexos.

### 3. Operação de Salvamento (T-SAVE)

- **Ação:** Tempo total para salvar uma nova encomenda, incluindo a "mineração" do bloco criptográfico.
- **Medição:** `performance.now()` no início do método `db.addEncomenda()` até a sua conclusão.
- **Meta:** **< 500 ms** (para garantir que a UI não "trave" após o clique em Salvar).
- **Teste de Estresse:** Não aplicável, pois a dificuldade de mineração é fixa. O teste foca na percepção do usuário.

### 4. Interatividade do Dashboard (T-UI)

- **Ação:** Responsividade da interface ao digitar no campo de busca ou ao clicar em um filtro de status.
- **Medição:** Medir o tempo entre a alteração do `searchQuery` ou `activeFilter` e a re-renderização da lista.
- **Meta:** **< 100 ms** (deve parecer instantâneo, sem "engasgos").
- **Teste de Estresse:** Com o banco de dados local populado com 1.000 encomendas, digitar rapidamente no campo de busca.
