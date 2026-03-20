
import { Injectable, inject } from '@angular/core';
import { UiService } from './ui.service';
import { DbService, InboxMessage, LinkedCondo } from './db.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let google: any;

@Injectable({
  providedIn: 'root'
})
export class GoogleDriveService {
  private ui = inject(UiService);
  private db = inject(DbService);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tokenClient: any = null; 
  private accessToken: string | null = null;

  constructor() {}

  initTokenClient(clientId: string) {
    if (!clientId) {
      this.tokenClient = null;
      this.accessToken = null;
      return;
    }
    
    if (typeof google === 'undefined' || !google.accounts) {
      console.error('Google Identity Services script not loaded.');
      return;
    }

    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      // SCOPE EXPANDIDO: Permite ler metadados para encontrar relatórios de outros condomínios
      scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback: (response: any) => {
        if (response.error !== undefined) {
          console.error('Auth Error', response);
          this.ui.show('Erro na autenticação do Google.', 'ERROR');
          throw response;
        }
        this.accessToken = response.access_token;
      },
    });
  }

  async uploadBackup(fileName: string, jsonContent: string, clientId: string): Promise<boolean> {
    if (!navigator.onLine) {
      this.ui.show('Sem internet. Backup em nuvem indisponível.', 'WARNING');
      return false;
    }

    if (!clientId) {
      this.ui.show('Client ID do Google não configurado.', 'ERROR');
      return false;
    }

    if (!this.tokenClient) {
      this.initTokenClient(clientId);
    }

    return new Promise((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.tokenClient.callback = async (resp: any) => {
        if (resp.error) {
           this.ui.show('Acesso ao Google Negado.', 'ERROR');
           resolve(false);
           return;
        }
        this.accessToken = resp.access_token;
        
        try {
          await this.uploadFileMultipart(fileName, jsonContent);
          this.ui.show('Backup enviado para o Google Drive!', 'SUCCESS');
          resolve(true);
        } catch (e) {
          console.error('Upload Failed', e);
          this.ui.show('Falha no upload para o Google Drive.', 'ERROR');
          resolve(false);
        }
      };

      if (google && google.accounts) {
         this.tokenClient.requestAccessToken({ prompt: '' });
      } else {
         this.ui.show('Scripts do Google não carregados.', 'ERROR');
         resolve(false);
      }
    });
  }

  /**
   * VARREDURA DE REDE (MULTI-CONDOMÍNIO)
   * Procura por arquivos que começam com 'simbiose_report_' no Google Drive.
   * Estes arquivos representam os "pings" de outros condomínios.
   */
  async syncNetworkData(clientId: string): Promise<void> {
      if (!clientId) {
          this.ui.show('Configure o Google Client ID primeiro.', 'WARNING');
          return;
      }
      
      this.ui.show('Conectando à Rede Simbiose (Drive)...', 'INFO');

      if (!this.tokenClient) {
          this.initTokenClient(clientId);
      }

      // Trigger Auth Flow
      if (google && google.accounts) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.tokenClient.callback = async (resp: any) => {
              if (resp.error) {
                  this.ui.show('Falha na conexão de rede.', 'ERROR');
                  return;
              }
              this.accessToken = resp.access_token;
              await this._fetchNetworkReports();
          };
          this.tokenClient.requestAccessToken({ prompt: '' });
      }
  }

  private async _fetchNetworkReports() {
      try {
          // Busca arquivos JSON que começam com 'simbiose_report_' e não estão na lixeira
          const query = "name contains 'simbiose_report_' and mimeType = 'application/json' and trashed = false";
          const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime)`;
          
          const response = await fetch(url, {
              headers: { 'Authorization': `Bearer ${this.accessToken}` }
          });
          
          if (!response.ok) throw new Error(await response.text());
          
          const result = await response.json();
          const files = result.files || [];
          
          let newMessagesCount = 0;

          // Processa cada arquivo encontrado
          for (const file of files) {
              const fileContent = await this.downloadFile(file.id);
              if (fileContent) {
                  this.processNetworkReport(fileContent);
                  newMessagesCount++;
              }
          }
          
          if (newMessagesCount > 0) {
              this.ui.show(`${newMessagesCount} atualizações de rede recebidas.`, 'SUCCESS');
          } else {
              this.ui.show('Nenhuma atualização nova na rede.', 'INFO');
          }

      } catch (e) {
          console.error('Network Sync Error', e);
          this.ui.show('Erro ao sincronizar rede.', 'ERROR');
      }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async downloadFile(fileId: string): Promise<any> {
      try {
          const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
              headers: { 'Authorization': `Bearer ${this.accessToken}` }
          });
          return await response.json();
      } catch {
          return null;
      }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private processNetworkReport(report: any) {
      // 1. Atualiza lista de condomínios linkados
      if (report.condoId && report.nomeCondominio) {
          const linked: LinkedCondo = {
              id: report.condoId,
              name: report.nomeCondominio,
              lastSync: new Date().toISOString(),
              status: 'ONLINE',
              stats: {
                  pendingPackages: report.totalPendentes || 0,
                  efficiency: report.eficiencia || 0
              }
          };
          this.db.updateLinkedCondo(linked);
      }

      // 2. Converte alertas em Inbox
      if (report.alertas && Array.isArray(report.alertas)) {
          report.alertas.forEach((alerta: string) => {
              const msg: InboxMessage = {
                  id: crypto.randomUUID(),
                  type: 'NETWORK_REPORT',
                  subject: `Relatório: ${report.nomeCondominio}`,
                  content: alerta,
                  timestamp: new Date().toISOString(),
                  read: false,
                  priority: 'NORMAL',
                  sourceCondo: report.nomeCondominio
              };
              this.db.addInboxMessage(msg);
          });
      }
  }

  private async uploadFileMultipart(fileName: string, content: string) {
    const metadata = {
      name: fileName,
      mimeType: 'application/json'
    };

    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    const multipartRequestBody =
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        content +
        close_delim;

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartRequestBody
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }
    
    return await response.json();
  }
}
