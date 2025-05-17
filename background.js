// background.js - atualizado com suporte para modo automático e melhorias no download
chrome.runtime.onInstalled.addListener(function () {
  // Configura os valores padrão
  chrome.storage.local.set({
    isCapturing: false,
    operationMode: "auto", // Modo automático ativado por padrão
    autoSave: false, // Perguntar ao Finalizar desativado por padrão (salva automaticamente)
  });
});

// Escuta a mensagem para salvar o arquivo
chrome.runtime.onMessage.addListener(function (request, _sender, sendResponse) {
  if (request.action === "download_transcript") {
    if (typeof request.index === "number") {
      downloadTranscript(request.index)
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error) => {
          console.error("Erro ao baixar transcrição:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
    } else {
      sendResponse({ success: false, error: "Índice inválido" });
    }
  }

  if (request.action === "saveFile") {
    console.log("Background: recebeu solicitação para salvar arquivo", {
      saveAs: request.saveAs,
      contentLength: request.content ? request.content.length : 0,
      fromTabClose: request.fromTabClose || false,
    });

    if (!request.content || request.content.length === 0) {
      console.error("Erro: Conteúdo vazio para download");
      sendResponse({
        status: "error",
        error: "Conteúdo vazio",
        message: "Não há conteúdo para salvar",
      });
      return true;
    }

    try {
      // Criar um nome de arquivo com timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `google-meet-captions-${timestamp}.txt`;

      console.log("Preparando download com nome:", filename);

      // Criar blob com o conteúdo
      const blob = new Blob([request.content], { type: "text/plain" });

      // Função para iniciar o download
      const startDownload = (url) => {
        console.log("Iniciando download do arquivo...");

        chrome.downloads.download(
          {
            url: url,
            filename: filename,
            saveAs: request.saveAs || false,
            conflictAction: "uniquify",
          },
          (downloadId) => {
            if (chrome.runtime.lastError) {
              console.error("Erro ao iniciar download:", chrome.runtime.lastError);
              sendResponse({
                status: "error",
                error: chrome.runtime.lastError,
                message: "Falha ao iniciar o download"
              });
            } else {
              console.log("Download iniciado com sucesso, ID:", downloadId);

              // Revoga a URL após um breve período para liberar memória
              if (typeof URL !== 'undefined' && URL.revokeObjectURL && url.startsWith('blob:')) {
                setTimeout(() => {
                  URL.revokeObjectURL(url);
                  console.log("URL do objeto revogada");
                }, 1000);
              }

              sendResponse({
                status: "success",
                downloadId: downloadId,
                message: "Download iniciado com sucesso",
              });
            }
          }
        );
      };

      // Verificar se URL.createObjectURL está disponível
      if (typeof URL !== 'undefined' && URL.createObjectURL) {
        const url = URL.createObjectURL(blob);
        console.log("Usando URL.createObjectURL para download");
        startDownload(url);
      } else {
        // Usar FileReader como alternativa
        console.log("URL.createObjectURL não disponível, usando FileReader");
        const reader = new FileReader();

        reader.onload = function() {
          const url = reader.result;
          console.log("FileReader concluído, continuando com download");
          startDownload(url);
        };

        reader.onerror = function() {
          console.error("Erro ao ler arquivo com FileReader:", reader.error);
          sendResponse({
            status: "error",
            error: "Falha ao ler arquivo",
            message: "Não foi possível processar o arquivo para download"
          });
        };

        reader.readAsDataURL(blob);
        return true; // Manter conexão aberta para resposta assíncrona
      }
    } catch (error) {
      console.error("Exceção ao processar download:", error);
      sendResponse({
        status: "error",
        error: error.toString(),
        message: "Erro ao processar o arquivo para download",
      });
    }

    return true; // Mantém a conexão aberta para resposta assíncrona
  }
});

function downloadTranscript(index) {
  return new Promise((resolve, reject) => {
    console.log("Iniciando download da transcrição com índice:", index);

    chrome.storage.local.get(["meetings"], function (result) {
      console.log("Reuniões recuperadas:", result.meetings?.length || 0);

      if (!result.meetings || !result.meetings[index]) {
        console.error("Reunião não encontrada no índice:", index);
        reject(new Error("Reunião não encontrada"));
        return;
      }

      const meeting = result.meetings[index];
      console.log("Meeting data:", meeting);

      if (!meeting.transcript || meeting.transcript.length === 0) {
        console.error("Transcrição vazia para a reunião:", index);
        reject(new Error("Transcrição vazia"));
        return;
      }

      try {
        // Sanitizar o título
        const sanitisedMeetingTitle = (
          meeting.meetingTitle || "Google Meet"
        ).replace(/[\\/:*?"<>|]/g, "_");

        // Formatar timestamp
        const timestamp = new Date(meeting.meetingEndTimestamp);
        const formattedTimestamp = timestamp
          .toLocaleString()
          .replace(/[\/:\\]/g, "-");

        const fileName = `Google-Meet-Legendas-${sanitisedMeetingTitle}-${formattedTimestamp}.txt`;

        // Formatar conteúdo
        let content = "";
        content += `Transcrição de: ${meeting.meetingTitle || "Google Meet"}\n`;
        content += `Início: ${new Date(
          meeting.meetingStartTimestamp
        ).toLocaleString()}\n`;
        content += `Término: ${new Date(
          meeting.meetingEndTimestamp
        ).toLocaleString()}\n`;
        content += `Duração: ${getDuration(
          meeting.meetingStartTimestamp,
          meeting.meetingEndTimestamp
        )}\n`;
        content += `Total de blocos de legendas: ${meeting.transcript.length}\n`;
        content += "----------------------------------------\n\n";

        // Adicionar as transcrições
        for (const block of meeting.transcript) {
          if (
            block &&
            block.timestamp &&
            block.personName &&
            block.transcriptText
          ) {
            content += `[${new Date(block.timestamp).toLocaleTimeString()}] ${
              block.personName
            }: ${block.transcriptText}\n\n`;
          }
        }

        content += "----------------------------------------\n";
        content += "Capturado com Google Meet Caption Saver";

        console.log("Conteúdo preparado, tamanho:", content.length);

        // Criar blob com o conteúdo
        const blob = new Blob([content], { type: "text/plain" });

        // Função para iniciar o download
        const startDownload = (url) => {
          console.log("Blob criado, URL:", url ? (url.substring(0, 50) + "...") : "usando método alternativo");

          chrome.downloads.download(
            {
              url: url,
              filename: fileName,
              saveAs: false,
            },
            (downloadId) => {
              if (chrome.runtime.lastError) {
                console.error("Erro no download:", chrome.runtime.lastError);

                // Tentar método alternativo sem saveAs
                chrome.downloads.download(
                  {
                    url: url,
                    filename: "Google-Meet-Legendas.txt",
                    saveAs: false,
                  },
                  (altDownloadId) => {
                    if (chrome.runtime.lastError) {
                      console.error(
                        "Erro no download alternativo:",
                        chrome.runtime.lastError
                      );
                      reject(new Error("Falha em ambos os métodos de download"));
                    } else {
                      console.log(
                        "Download alternativo iniciado, ID:",
                        altDownloadId
                      );
                      resolve("Download alternativo iniciado");
                    }
                  }
                );
              } else {
                console.log("Download iniciado, ID:", downloadId);

                // Revogar URL após um tempo
                if (typeof URL !== 'undefined' && URL.revokeObjectURL && url.startsWith('blob:')) {
                  setTimeout(() => {
                    URL.revokeObjectURL(url);
                    console.log("URL do objeto revogada");
                  }, 1000);
                }

                resolve("Download iniciado com sucesso");
              }
            }
          );
        };

        // Verificar se URL.createObjectURL está disponível
        if (typeof URL !== 'undefined' && URL.createObjectURL) {
          const url = URL.createObjectURL(blob);
          console.log("Usando URL.createObjectURL para download");
          startDownload(url);
        } else {
          // Usar FileReader como alternativa
          console.log("URL.createObjectURL não disponível, usando FileReader");
          const reader = new FileReader();

          reader.onload = function() {
            const url = reader.result;
            console.log("FileReader concluído, continuando com download");
            startDownload(url);
          };

          reader.onerror = function() {
            console.error("Erro ao ler arquivo com FileReader:", reader.error);
            reject(new Error("Falha ao ler arquivo para download"));
          };

          reader.readAsDataURL(blob);
        }
      } catch (error) {
        console.error("Erro ao preparar download:", error);
        reject(error);
      }
    });
  });
}

// Adicionar ao background.js
chrome.runtime.onMessage.addListener(function (request, _sender, sendResponse) {
  if (request.action === "save_to_history") {
    console.log(
      "Background: recebeu solicitação para salvar no histórico",
      request
    );

    if (!request.transcript || request.transcript.length === 0) {
      console.error("Dados de transcrição vazios");
      sendResponse({ status: "error", message: "Transcrição vazia" });
      return true;
    }

    // Criar objeto de reunião
    const meeting = {
      meetingTitle: request.meetingTitle || "Google Meet",
      meetingStartTimestamp: request.meetingStartTimestamp,
      meetingEndTimestamp: request.meetingEndTimestamp,
      transcript: request.transcript,
    };

    // Obter reuniões existentes
    chrome.storage.local.get(["meetings"], function (result) {
      let meetings = result.meetings || [];
      console.log("Reuniões existentes:", meetings.length);

      // Adicionar nova reunião
      meetings.push(meeting);

      // Limitar a 10 reuniões
      if (meetings.length > 10) {
        meetings = meetings.slice(-10);
      }

      // Salvar reuniões atualizadas
      chrome.storage.local.set({ meetings: meetings }, function () {
        console.log(
          "Reunião salva no histórico. Total de reuniões:",
          meetings.length
        );
        sendResponse({
          status: "success",
          message: "Reunião salva no histórico",
        });
      });
    });

    return true; // Manter conexão aberta para resposta assíncrona
  }

  if (request.action === "ping_background") {
    console.log("Recebido ping no background, respondendo");
    sendResponse({ status: "background_alive" });
    return true;
  }

  if (request.action === "meeting_ended") {
    console.log("Background: recebeu notificação de fim de reunião", request);

    // Verificar se temos dados válidos
    if (!request.transcript || request.transcript.length === 0) {
      console.error("Dados de transcrição vazios");
      sendResponse({ status: "error", message: "Transcrição vazia" });
      return true;
    }

    // Criar novo objeto de reunião
    const meeting = {
      meetingTitle: request.meetingTitle || "Google Meet",
      meetingStartTimestamp: request.meetingStartTimestamp,
      meetingEndTimestamp: request.meetingEndTimestamp,
      transcript: request.transcript,
    };

    console.log("Objeto de reunião criado:", meeting);

    // Obter reuniões existentes
    chrome.storage.local.get(["meetings"], function (result) {
      console.log("Reuniões existentes:", result.meetings);

      let meetings = result.meetings || [];
      meetings.push(meeting);

      // Limitar a 10 reuniões mais recentes
      if (meetings.length > 10) {
        meetings = meetings.slice(-10);
      }

      // Salvar reuniões atualizadas
      chrome.storage.local.set({ meetings: meetings }, function () {
        console.log(
          "Reunião salva no histórico. Total de reuniões:",
          meetings.length
        );

        // Iniciar download do arquivo apenas se não for para pular o download
        if (!request.skipDownload) {
          console.log("Iniciando download da transcrição");
          try {
            downloadTranscript(meetings.length - 1)
              .then(() => {
                console.log("Download iniciado com sucesso");
              })
              .catch((err) => {
                console.error("Erro ao baixar transcrição:", err);
              });
          } catch (error) {
            console.error("Erro ao iniciar download:", error);
          }
        } else {
          console.log("Download ignorado conforme solicitado (skipDownload=true)");
        }
      });
    });

    sendResponse({ status: "success" });
    return true;
  }

  if (request.action === "new_meeting_started") {
    // Salvar o ID da aba atual para uso posterior
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const tabId = tabs[0].id;
      chrome.storage.local.set({ meetingTabId: tabId }, function () {
        console.log("ID da aba da reunião salvo:", tabId);
        sendResponse({ status: "success" });
      });
    });
    return true;
  }

  if (request.action === "tab_closed") {
    console.log("Background: recebeu notificação de fechamento de aba");

    // Criar novo objeto de reunião
    const meeting = {
      meetingTitle: request.meetingTitle || "Google Meet",
      meetingStartTimestamp: request.meetingStartTimestamp,
      meetingEndTimestamp: request.meetingEndTimestamp,
      transcript: request.transcript,
    };

    // Obter reuniões existentes
    chrome.storage.local.get(["meetings"], function (result) {
      let meetings = result.meetings || [];
      meetings.push(meeting);

      // Limitar a 10 reuniões mais recentes
      if (meetings.length > 10) {
        meetings = meetings.slice(-10);
      }

      // Salvar reuniões atualizadas
      chrome.storage.local.set({ meetings: meetings }, function () {
        console.log("Reunião salva no histórico (fechamento de aba)");

        // Iniciar download do arquivo
        downloadTranscript(meetings.length - 1);
      });
    });

    sendResponse({ status: "success" });
    return true;
  }

  // Handler para saveFile existente aqui
});

// Outra maneira de detectar fechamento de aba
chrome.tabs.onRemoved.addListener(function (tabId) {
  chrome.storage.local.get(["meetingTabId"], function (result) {
    if (tabId === result.meetingTabId) {
      console.log("Detectou fechamento da aba da reunião");

      // Verificar se há dados temporários de transcrição para salvar
      chrome.storage.local.get(
        ["transcript", "meetingTitle", "meetingStartTimestamp"],
        function (data) {
          if (data.transcript && data.transcript.length > 0) {
            // Criar novo objeto de reunião
            const meeting = {
              meetingTitle: data.meetingTitle || "Google Meet",
              meetingStartTimestamp:
                data.meetingStartTimestamp || new Date().toISOString(),
              meetingEndTimestamp: new Date().toISOString(),
              transcript: data.transcript,
            };

            // Obter reuniões existentes
            chrome.storage.local.get(["meetings"], function (result) {
              let meetings = result.meetings || [];
              meetings.push(meeting);

              // Limitar a 10 reuniões mais recentes
              if (meetings.length > 10) {
                meetings = meetings.slice(-10);
              }

              // Salvar reuniões atualizadas
              chrome.storage.local.set({ meetings: meetings }, function () {
                console.log(
                  "Reunião salva no histórico (fechamento de aba via tabs.onRemoved)"
                );

                // Iniciar download do arquivo
                downloadTranscript(meetings.length - 1);
              });
            });
          }
        }
      );
    }
  });
});

// Função auxiliar para calcular a duração
function getDuration(startTimestamp, endTimestamp) {
  const duration =
    new Date(endTimestamp).getTime() - new Date(startTimestamp).getTime();
  const durationMinutes = Math.round(duration / (1000 * 60));
  const durationHours = Math.floor(durationMinutes / 60);
  const remainingMinutes = durationMinutes % 60;
  return durationHours > 0
    ? `${durationHours}h ${remainingMinutes}m`
    : `${durationMinutes}m`;
}
