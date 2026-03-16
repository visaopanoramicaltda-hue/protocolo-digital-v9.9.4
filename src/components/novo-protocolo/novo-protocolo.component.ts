// 3. Gerar PDF
const porteiro = { nome: 'ADMIN', cpf: '', isAdmin: true };
const encomendaObj = { ...dadosProtocolo, destinatario: dadosPessoa.nome };
const { blob, url, hash } = await pdfService.generateEntryProtocol(encomendaObj, porteiro);

// Ajustar depois as chamadas subsequentes para utilizar o blob gerado.
// Remover o uso de pdfService.gerarComprovante.