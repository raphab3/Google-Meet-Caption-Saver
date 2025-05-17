/**
 * @typedef {Object} TranscriptBlock
 * @property {string} personName - Nome da pessoa que falou
 * @property {string} timestamp - Timestamp ISO de quando as palavras foram faladas
 * @property {string} transcriptText - Texto real da transcrição
 */

// Array para armazenar a transcrição
/** @type {TranscriptBlock[]} */
let transcript = [];
let meetingStartTimestamp = new Date().toISOString();
let meetingTitle = "Google Meet";
// Variável global para controlar o estado de captura
let isCapturing = false;

// Função auxiliar para enviar mensagens de forma segura para o background script
function sendMessageSafely(message, callback) {
  try {
    // Verificar se o contexto da extensão ainda é válido
    if (chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage(message, function (response) {
        if (chrome.runtime.lastError) {
          console.error("Erro ao enviar mensagem:", chrome.runtime.lastError);
          if (callback) callback(null);
        } else {
          if (callback) callback(response);
        }
      });
    } else {
      console.warn("Contexto da extensão invalidado, não é possível enviar mensagem");
      if (callback) callback(null);
    }
  } catch (error) {
    console.error("Erro ao tentar enviar mensagem para o background script:", error);
    if (callback) callback(null);
  }
}

// Adicionar ao content.js
window.addEventListener("beforeunload", function (event) {
  // Só faz algo se estiver capturando legendas
  if (isCapturing && transcript.length > 0) {
    console.log("Detectado fechamento da aba com legendas capturadas");

    // Marcar como não capturando imediatamente para evitar chamadas duplicadas
    isCapturing = false;

    // Criar uma cópia do transcript para evitar modificações
    const transcriptCopy = [...transcript];

    // Capturar dados da reunião atual
    const meetingData = {
      action: "tab_closed",
      meetingTitle:
        document.querySelector(".u6vdEc")?.textContent || "Google Meet",
      meetingStartTimestamp: meetingStartTimestamp,
      meetingEndTimestamp: new Date().toISOString(),
      transcript: transcriptCopy,
      // Não precisamos de skipDownload aqui, pois o background script já vai fazer o download
    };

    // Usar o background script para garantir que o download funcione
    sendMessageSafely(meetingData, function(response) {
      console.log("Resposta do background script:", response);
    });

    // Dar tempo ao usuário para decidir se quer ficar na página
    event.preventDefault();
    event.returnValue =
      "Você tem legendas capturadas. Deseja salvá-las antes de sair?";
  }
});
(function () {
  // Variáveis principais
  let finalTranscript = []; // Array para armazenar a versão final da transcrição
  let captionObserver = null;
  let meetEndObserver = null;
  let autoMode = false;
  let autoSave = false;

  // Função para inicializar a extensão para uma nova reunião
  function initializeForMeeting() {
    // Resetar variáveis
    transcript = [];
    finalTranscript = [];
    meetingStartTimestamp = new Date().toISOString();
    meetingTitle =
      document.querySelector(".u6vdEc")?.textContent || "Google Meet";

    // Salvar ID da aba
    sendMessageSafely({
      action: "new_meeting_started",
    });

    // Salvar dados iniciais
    chrome.storage.local.set({
      meetingTitle: meetingTitle,
      meetingStartTimestamp: meetingStartTimestamp,
      transcript: transcript,
    });

    // Ativar legendas imediatamente usando a função fornecida pelo usuário
    console.log("Ativando legendas imediatamente ao entrar na reunião");

    // Primeiro tentar com a função ativarLegendas
    const legendasAtivadas = ativarLegendas();

    // Se não conseguiu ativar, tentar com enableCaptions como fallback
    if (!legendasAtivadas) {
      console.log("Tentando método alternativo para ativar legendas");
      enableCaptions().then((captionsEnabled) => {
        console.log("Resultado da ativação alternativa de legendas:", captionsEnabled);
      });
    }

    // Verificar configurações de modo automático
    chrome.storage.local.get(["operationMode"], function (result) {
      if (result.operationMode === "auto") {
        console.log("Modo automático ativado, iniciando captura");
        // Iniciar a captura após um breve intervalo
        setTimeout(() => {
          startCapturing();
        }, 2000);
      } else {
        console.log("Modo manual ativado. Legendas foram ativadas, mas a captura não será iniciada automaticamente.");
      }
    });

    // Tentar ativar legendas novamente após um intervalo maior
    setTimeout(() => {
      if (!isLegendaAtiva()) {
        console.log("Legendas ainda não ativas, tentando novamente...");
        ativarLegendas();
      }
    }, 5000);
  }

  function cleanCaptionText(text) {
    if (!text) return "";

    // Lista de textos a serem removidos
    const textosParaRemover = [
      "arrow_downwardJump to bottom",
      "Jump to bottom",
      "arrow_downward",
      "keyboard_arrow_down",
      "expand_more",
    ];

    let cleanedText = text;

    // Remover cada texto indesejado
    textosParaRemover.forEach((textoIndesejado) => {
      cleanedText = cleanedText.replace(new RegExp(textoIndesejado, "g"), "");
    });

    // Remover duplicações de nomes (ex: "YouYou" -> "You")
    cleanedText = cleanedText.replace(/^(\w+)\1+/, "$1");

    // Limpar espaços extras
    cleanedText = cleanedText.trim();

    return cleanedText;
  }

  // Função para ativar as legendas automaticamente
  function enableCaptions() {
    return new Promise((resolve) => {
      function ativarLegendas() {
        console.log("Iniciando tentativa de ativar legendas...");

        // Verificar primeiro se as legendas já estão ativas
        const captionsContainer = document.querySelector(
          'div[role="region"][tabindex="0"], div[aria-live="polite"], div[jsname][data-message-text], div[jscontroller][jsaction*="captions"]'
        );
        if (captionsContainer) {
          console.log("Legendas já estão ativas:", captionsContainer);
          return true;
        }

        // Verificar se o botão "call_end" está visível (reunião em andamento)
        // Método 1: Procurar pelo ícone call_end
        const callEndIcons = document.querySelectorAll('button i.google-symbols, button i.quRWN-Bz112c');
        let hasCallEndButton = false;

        for (const icon of callEndIcons) {
          if (icon.textContent.includes('call_end') && icon.offsetParent !== null) {
            console.log("Botão 'call_end' encontrado pelo ícone");
            hasCallEndButton = true;
            break;
          }
        }

        // Método 2: Procurar pelo botão com aria-label "Leave call"
        if (!hasCallEndButton) {
          const leaveCallButtons = document.querySelectorAll('button[aria-label*="Leave call" i], button[aria-label*="Sair" i], button[aria-label*="Desligar" i]');
          for (const button of leaveCallButtons) {
            if (button.offsetParent !== null) {
              console.log("Botão 'call_end' encontrado pelo aria-label");
              hasCallEndButton = true;
              break;
            }
          }
        }

        if (!hasCallEndButton) {
          console.log("Botão 'call_end' não encontrado - não estamos na reunião real ainda");
          return false;
        }

        // Verificar se o tooltip "ucc-9" está visível
        // Método 1: Procurar pelo elemento com data-tooltip-id="ucc-9"
        const hasUcc9Tooltip = !!document.querySelector('[data-tooltip-id="ucc-9"]');

        // Método 2: Procurar pelo div com tooltip-id="ucc-9"
        const hasUcc9TooltipDiv = !!document.querySelector('div[tooltip-id="ucc-9"]');

        console.log("Tooltip ucc-9 está visível?", hasUcc9Tooltip || hasUcc9TooltipDiv);

        // Lista de seletores para o botão de legendas (tanto para ativar quanto desativar)
        const seletoresBotaoLegendas = [
          // Botão moderno de legendas (com aria-label)
          'button[aria-label*="Turn on captions" i], button[aria-label*="Ativar legendas" i], button[aria-label*="Turn off captions" i], button[aria-label*="Desativar legendas" i]',

          // Botão com nome específico
          'button[jsname="r8qRAd"]',

          // Botão com tooltip
          'button[data-tooltip-id*="ucc"]',

          // Botão com tooltip específico
          'button[data-tooltip*="legenda" i], button[data-tooltip*="caption" i]',

          // Abordagem genérica
          '.VYBDae-Bz112c-LgbsSe, .VfPpkd-Bz112c-LgbsSe, .hk9qKe',

          // Seletores mais genéricos para botões
          "button.uArJ5e, button.U26fgb"
        ];

        // Função para verificar se um botão é o de legendas
        function isCaptionButton(button) {
          // Se não for um botão ou não estiver visível, ignorar
          if (!button || !button.offsetParent) return false;

          // Verificar atributos
          const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
          if (ariaLabel.includes('caption') || ariaLabel.includes('legenda')) {
            return true;
          }

          // Verificar se tem ícone de legenda
          const icons = button.querySelectorAll('i.google-symbols, i.quRWN-Bz112c');
          if (icons.length > 0) {
            const hasCaptionIcon = Array.from(icons).some(icon =>
              icon.textContent.toLowerCase().includes('closed_caption')
            );
            if (hasCaptionIcon) {
              return true;
            }
          }

          // Verificar data-tooltip
          const tooltip = (button.getAttribute('data-tooltip') || '').toLowerCase();
          if (tooltip.includes('caption') || tooltip.includes('legenda')) {
            return true;
          }

          // Verificar texto do botão
          const buttonText = button.textContent.toLowerCase();
          if (buttonText.includes('caption') || buttonText.includes('legenda')) {
            return true;
          }

          return false;
        }

        // Procurar o botão de legendas usando os seletores
        let captionButton = null;

        // Se o tooltip ucc-9 não estiver visível, procurar especificamente por botões com ícone "closed_caption"
        const isUcc9Visible = hasUcc9Tooltip || hasUcc9TooltipDiv;
        if (!isUcc9Visible) {
          console.log("Tooltip ucc-9 não está visível, procurando botão CC...");

          // Método 1: Procurar pelo botão com jsname="r8qRAd" (identificado no HTML)
          const r8qRadButton = document.querySelector('button[jsname="r8qRAd"]');
          if (r8qRadButton && r8qRadButton.offsetParent !== null) {
            captionButton = r8qRadButton;
            console.log("Encontrou botão CC pelo jsname r8qRAd:", captionButton);
          }

          // Método 2: Procurar por botões com ícone closed_caption
          if (!captionButton) {
            const allButtons = document.querySelectorAll('button');
            for (const button of allButtons) {
              const icons = button.querySelectorAll('i.google-symbols, i.quRWN-Bz112c');
              if (icons.length > 0) {
                const hasCaptionIcon = Array.from(icons).some(icon =>
                  icon.textContent.toLowerCase().includes('closed_caption')
                );
                if (hasCaptionIcon && button.offsetParent !== null) {
                  captionButton = button;
                  console.log("Encontrou botão CC pelo ícone:", button);
                  break;
                }
              }
            }
          }

          // Método 3: Procurar por botões com aria-label relacionado a legendas
          if (!captionButton) {
            const captionAriaButtons = document.querySelectorAll('button[aria-label*="caption" i], button[aria-label*="legenda" i]');
            for (const button of captionAriaButtons) {
              if (button.offsetParent !== null) {
                captionButton = button;
                console.log("Encontrou botão CC pelo aria-label:", button);
                break;
              }
            }
          }
        }

        // Se não encontrou o botão CC específico, usar os seletores normais
        if (!captionButton) {
          for (const seletor of seletoresBotaoLegendas) {
            try {
              const elementos = document.querySelectorAll(seletor);
              for (const elemento of elementos) {
                if (isCaptionButton(elemento)) {
                  captionButton = elemento;
                  break;
                }
              }
              if (captionButton) break;
            } catch (erro) {
              console.warn(`Erro ao usar seletor ${seletor}:`, erro);
            }
          }
        }

        // Se ainda não encontrou, procurar todos os botões
        if (!captionButton) {
          console.log("Não encontrou com seletores específicos, verificando todos os botões...");
          const allButtons = document.querySelectorAll('button');
          for (const button of allButtons) {
            if (isCaptionButton(button)) {
              captionButton = button;
              break;
            }
          }
        }

        // Se encontrou o botão, clica nele
        if (captionButton) {
          console.log("Botão de legendas encontrado:", captionButton);

          // Verificar se as legendas já estão ativas
          const ariaLabel = (captionButton.getAttribute('aria-label') || '').toLowerCase();
          const legendasAtivas = ariaLabel.includes('turn off') || ariaLabel.includes('desativar');

          if (legendasAtivas) {
            console.log("As legendas já estão ativas!");
            return true;
          }

          // Clicar no botão
          captionButton.click();
          console.log("Clique no botão de legendas executado");

          // Verificar se as legendas apareceram
          setTimeout(() => {
            const containerLegendas = document.querySelector('div[role="region"][tabindex="0"], div[aria-label="Captions"], .ZPyPXe');
            if (containerLegendas) {
              console.log("Legendas ativadas com sucesso!");
              resolve(true);
            } else {
              console.log("Não foi possível confirmar se as legendas foram ativadas. Tentando novamente...");
              resolve(false);
            }
          }, 2000);

          return true;
        } else {
          // Tentar pelo botão de três pontos
          console.log("Tentando pelo menu de três pontos...");

          const moreOptionsButton = document.querySelector('button[aria-label*="mais" i], button[aria-label*="more" i], button[data-tooltip*="Mais"]');
          if (moreOptionsButton) {
            console.log("Botão de mais opções encontrado, clicando...");
            moreOptionsButton.click();

            // Esperar o menu abrir
            setTimeout(() => {
              const menuItems = document.querySelectorAll('div[role="menuitem"], span[role="menuitem"]');
              for (const item of menuItems) {
                const itemText = item.textContent.toLowerCase();
                if (itemText.includes("legenda") || itemText.includes("caption")) {
                  console.log("Opção de legendas encontrada no menu, clicando...");
                  item.click();

                  // Verificar se as legendas apareceram
                  setTimeout(() => {
                    const containerLegendas = document.querySelector('div[role="region"][tabindex="0"], div[aria-label="Captions"], .ZPyPXe');
                    if (containerLegendas) {
                      console.log("Legendas ativadas com sucesso pelo menu!");
                      resolve(true);
                    } else {
                      console.log("Não foi possível confirmar se as legendas foram ativadas pelo menu.");
                      resolve(false);
                    }
                  }, 2000);

                  return true;
                }
              }
              console.log("Não encontrou opção de legendas no menu");
              resolve(false);
            }, 500);

            return true;
          }

          console.log("Não foi possível encontrar o botão de legendas");
          return false;
        }
      }

      // Executar a função de ativar legendas
      const resultado = ativarLegendas();

      // Se não conseguir na primeira tentativa, tenta novamente após 3 segundos
      if (!resultado) {
        console.log("Tentando ativar legendas novamente em 3 segundos...");
        setTimeout(() => {
          const segundaTentativa = ativarLegendas();

          // Uma terceira tentativa após mais 5 segundos
          if (!segundaTentativa) {
            console.log("Segunda tentativa falhou. Tentando novamente em 5 segundos...");
            setTimeout(() => {
              const terceiraTentativa = ativarLegendas();
              if (!terceiraTentativa) {
                console.log("Não foi possível ativar as legendas após várias tentativas");
                resolve(false);
              }
            }, 5000);
          }
        }, 3000);
      }
    });
  }

  // Função para configurar o observador de legendas
  function setupCaptionsObserver() {
    // Função para encontrar o contêiner de legendas
    function findCaptionsContainer() {
      // Lista de possíveis seletores, em ordem de prioridade
      const possibleSelectors = [
        `div[role="region"][tabindex="0"]`, // Interface ARIA moderna
        `div[role="region"][aria-label="Captions"]`, // Interface com label específico
        ".a4cQT", // Formato antigo
        ".Mz6pEf", // Formato mais antigo
        ".ZPyPXe", // Seletor para contêiner de legendas
        'div[jscontroller="KPn5nb"]', // Seletor baseado em controlador
      ];

      // Tenta cada seletor
      for (const selector of possibleSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          console.log(
            `Encontrou contêiner de legendas com seletor: ${selector}`
          );
          return element;
        }
      }

      console.warn("Não foi possível encontrar o contêiner de legendas");
      return null;
    }

    // Função para processar as legendas capturadas
    function processCaptions(mutations) {
      // Usamos um Set para evitar duplicações no mesmo ciclo de processamento
      const processedTexts = new Set();

      mutations.forEach((mutation) => {
        if (
          mutation.type === "childList" ||
          mutation.type === "characterData"
        ) {
          const container = findCaptionsContainer();
          if (!container) return;

          try {
            // Tentar encontrar elementos de legenda individuais
            const captionElements = container.querySelectorAll(
              'div[data-message-text], div.VbkSUe, div.bh44bd, div[jsname="tgaKEf"]'
            );

            if (captionElements && captionElements.length > 0) {
              // Processar cada elemento de legenda individualmente
              captionElements.forEach((element) => {
                // Ignorar elementos que são botões ou ícones
                if (
                  element.querySelector(
                    '[aria-label="Jump to bottom"], .google-symbols, button'
                  )
                ) {
                  return;
                }

                const captionText = element.textContent.trim();
                if (!captionText || captionText.length < 2) return; // Ignorar textos muito curtos

                // Remover "Jump to bottom" e textos relacionados a botões da UI
                let cleanedText = captionText;
                cleanedText = cleanedText.replace(
                  /arrow_downwardJump to bottom/g,
                  ""
                );
                cleanedText = cleanedText.replace(/Jump to bottom/g, "");
                cleanedText = cleanedText.replace(/arrow_downward/g, "");

                // Verificar novamente após limpeza
                if (!cleanedText || cleanedText.length < 2) return;

                // Evitar duplicações no mesmo ciclo
                if (processedTexts.has(cleanedText)) return;
                processedTexts.add(cleanedText);

                // Tentar identificar o falante
                let speakerName = "Você";

                // Procurar por elementos que possam conter o nome do falante
                const speakerElements = container.querySelectorAll(
                  ".KcIKyf, [data-self-name], [data-participant-id]"
                );
                if (speakerElements.length > 0) {
                  const possibleName = speakerElements[0].textContent.trim();
                  if (possibleName && possibleName.length > 0) {
                    speakerName = possibleName;
                  }
                }

                // Verificar se a última entrada é do mesmo falante
                const timestamp = new Date().toISOString();

                if (transcript.length > 0 && transcript[transcript.length - 1].personName === speakerName) {
                  // Atualizar a entrada existente em vez de adicionar uma nova
                  transcript[transcript.length - 1].transcriptText = cleanedText;
                  console.log(`Atualizando legenda: ${speakerName}: ${cleanedText}`);
                } else {
                  // Adicionar nova entrada para um novo falante
                  transcript.push({
                    personName: speakerName,
                    timestamp: timestamp,
                    transcriptText: cleanedText,
                  });
                  console.log(`Nova legenda: ${speakerName}: ${cleanedText}`);
                }
              });
            } else {
              // Fallback: extrair texto completo das legendas
              let captionText = container.textContent.trim();

              // Remover "Jump to bottom" e textos relacionados a botões da UI
              captionText = captionText.replace(
                /arrow_downwardJump to bottom/g,
                ""
              );
              captionText = captionText.replace(/Jump to bottom/g, "");
              captionText = captionText.replace(/arrow_downward/g, "");

              if (!captionText || captionText.length < 2) return;

              // Evitar duplicações no mesmo ciclo
              if (processedTexts.has(captionText)) return;
              processedTexts.add(captionText);

              // Tentar identificar o falante
              let speakerName = "Você";

              // Procurar por elementos que possam conter o nome do falante
              const speakerElements = container.querySelectorAll(
                ".KcIKyf, [data-self-name], [data-participant-id]"
              );
              if (speakerElements.length > 0) {
                speakerName = speakerElements[0].textContent.trim() || "Você";
              }

              // Verificar se a última entrada é do mesmo falante
              const timestamp = new Date().toISOString();

              if (transcript.length > 0 && transcript[transcript.length - 1].personName === speakerName) {
                // Atualizar a entrada existente em vez de adicionar uma nova
                transcript[transcript.length - 1].transcriptText = captionText;
                console.log(`Atualizando legenda (fallback): ${speakerName}: ${captionText}`);
              } else {
                // Adicionar nova entrada para um novo falante
                transcript.push({
                  personName: speakerName,
                  timestamp: timestamp,
                  transcriptText: captionText,
                });
                console.log(`Nova legenda (fallback): ${speakerName}: ${captionText}`);
              }
            }
          } catch (error) {
            console.error("Erro ao processar legendas:", error);
          }
        }
      });
    }

    // Encontrar o contêiner de legendas
    const captionsContainer = findCaptionsContainer();
    if (!captionsContainer) {
      console.error(
        "Não foi possível encontrar o contêiner de legendas para observar"
      );
      return false;
    }

    // Configurar o observador
    captionObserver = new MutationObserver(processCaptions);
    captionObserver.observe(captionsContainer, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Configurar o observador para detectar o fim da reunião
    meetEndObserver = setupMeetEndObserver();

    console.log("Observador de legendas configurado com sucesso");
    return true;
  }

  // Função para iniciar a captura de legendas
  function startCapturing() {
    console.log("Iniciando captura...");

    // Verificar se as legendas estão ativas
    if (!isLegendaAtiva()) {
      console.log("Legendas não estão ativas. Tentando ativar...");
      enableCaptions().then((success) => {
        if (success) {
          console.log("Legendas ativadas com sucesso, iniciando captura");
          doStartCapturing();
        } else {
          console.log("Não foi possível ativar as legendas");
          alert(
            "As legendas precisam estar ativadas para capturar. Por favor, ative as legendas manualmente usando o botão 'CC' no Google Meet e tente novamente."
          );
          return false;
        }
      });
      return false;
    } else {
      return doStartCapturing();
    }
  }

  function doStartCapturing() {
    if (isCapturing) return false;

    transcript = [];
    finalTranscript = [];
    meetingStartTimestamp = new Date().toISOString();
    meetingTitle =
      document.querySelector(".u6vdEc")?.textContent || "Google Meet";

    // Atualizar a variável global
    isCapturing = true;

    // Salvar dados iniciais
    chrome.storage.local.set({
      isCapturing: true,
      meetingTitle: meetingTitle,
      meetingStartTimestamp: meetingStartTimestamp,
    });

    // Ativa o indicador visual
    updateStatusIndicator(true);

    // Configura o observador
    const started = setupCaptionsObserver();

    return started;
  }

  function stopCapturing() {
    console.log("Parando captura de legendas");

    if (!isCapturing) {
      console.log("Não estava capturando, nada a fazer");
      return { captions: "", status: "not_capturing" };
    }

    // Marcar como não capturando imediatamente para evitar chamadas duplicadas
    isCapturing = false;
    chrome.storage.local.set({ isCapturing: false });

    if (captionObserver) {
      captionObserver.disconnect();
      captionObserver = null;
      console.log("Observer de legendas desconectado");
    }

    if (meetEndObserver) {
      meetEndObserver.disconnect();
      meetEndObserver = null;
      console.log("Observer de fim de reunião desconectado");
    }

    // Verifica se há legendas para salvar
    if (transcript.length === 0 && finalTranscript.length === 0) {
      console.log("Nenhuma legenda capturada para salvar");
      return {
        captions: "",
        error: "Não há legendas para salvar.",
        status: "no_captions",
      };
    }

    // Criar uma cópia do transcript para evitar modificações durante o processamento
    const transcriptCopy = [...transcript];

    // Prepara o cabeçalho
    const meetingTitle =
      document.querySelector(".u6vdEc")?.textContent || "Google Meet";
    const endDate = new Date();
    const header = [
      `Transcrição de ${meetingTitle}`,
      `Data: ${endDate.toLocaleDateString()}`,
      `Horário: ${endDate.toLocaleTimeString()}`,
      `Total de legendas capturadas: ${transcriptCopy.length}`,
      "----------------------------------------",
      "",
    ];

    // Formata as legendas capturadas
    const transcriptText = transcriptCopy.map(
      (entry) =>
        `[${new Date(entry.timestamp).toLocaleTimeString()}] ${
          entry.personName
        }: ${cleanCaptionText(entry.transcriptText)}`
    );

    // Combina cabeçalho com transcrição final
    const captionsText = header.concat(transcriptText).join("\n");

    // Armazenar no histórico
    const meetingData = {
      action: "meeting_ended",
      meetingTitle: meetingTitle,
      meetingStartTimestamp: meetingStartTimestamp,
      meetingEndTimestamp: endDate.toISOString(),
      transcript: transcriptCopy,
      // Adicionar flag para evitar download duplicado
      skipDownload: true
    };

    console.log("Enviando dados da reunião para o background:", meetingData);
    sendMessageSafely(meetingData);

    // Forçar download direto
    try {
      const blob = new Blob([captionsText], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `google-meet-captions-${timestamp}.txt`;

      const downloadLink = document.createElement("a");
      downloadLink.href = url;
      downloadLink.download = filename;
      downloadLink.style.display = "none";
      document.body.appendChild(downloadLink);
      downloadLink.click();

      setTimeout(() => {
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(url);
      }, 100);

      console.log("Download direto iniciado");
    } catch (error) {
      console.error("Erro no download direto:", error);

      // Tentar método alternativo
      sendMessageSafely({
        action: "saveFile",
        content: captionsText,
        saveAs: true,
      });
    }

    // Já enviamos os dados para o background script acima

    return { captions: captionsText, status: "success" };
  }

  // Função showStatusIndicator removida - substituída por updateStatusIndicator

  // Configurar observador para detectar o fim da reunião
  function setupMeetEndObserver() {
    // Função para detectar os botões de fim de reunião
    function findMeetEndButton() {
      const endCallButtons = document.querySelectorAll(
        'button[aria-label*="Sair" i], button[aria-label*="Leave" i], button[aria-label*="Desligar" i], button[aria-label*="Hang up" i]'
      );

      return endCallButtons.length > 0 ? endCallButtons[0] : null;
    }

    // Função para monitorar mudanças na página que indiquem fim da reunião
    function checkForMeetEnd() {
      // Verificar se saiu da reunião (URLs que indicam que não estamos mais em uma reunião ativa)
      if (
        window.location.href.includes("meet.google.com") &&
        !window.location.href.match(/\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?|$)/)
      ) {
        console.log("Detectou fim da reunião por mudança de URL");
        handleMeetEnd();
        return;
      }

      // Verifica elementos que aparecem ao final da reunião
      const postMeetUI = document.querySelector(
        'div[aria-label*="reunião terminou" i], div[aria-label*="meeting ended" i], div[role="dialog"][aria-modal="true"]'
      );

      if (postMeetUI) {
        console.log("Detectou UI de pós-reunião");
        handleMeetEnd();
      }
    }

    // Processar o fim da reunião
    function handleMeetEnd() {
      if (!isCapturing) return;

      console.log("Reunião finalizada, processando legendas...");

      // Parar a captura e obter as legendas
      const captionsResult = stopCapturing();

      if (captionsResult.captions && captionsResult.captions.length > 0) {
        console.log(
          `Reunião finalizada com ${transcript.length} blocos de legendas capturados`
        );

        // Salvar as legendas
        saveCaptions(captionsResult.captions, false, false);

        // Informar o background script que a reunião terminou
        chrome.runtime.sendMessage({
          action: "meeting_ended",
          meetingTitle:
            document.querySelector(".u6vdEc")?.textContent || "Google Meet",
          meetingStartTimestamp: meetingStartTimestamp,
          meetingEndTimestamp: new Date().toISOString(),
          transcript: transcript,
        });
      } else {
        console.log("Reunião finalizada sem legendas para salvar");
      }
    }

    // Inicia o observador para mudanças na URL que indicam fim da reunião
    window.addEventListener("popstate", checkForMeetEnd);

    // Verifica periodicamente se a reunião terminou
    setInterval(checkForMeetEnd, 5000);

    // Criar e iniciar o observer para detectar o botão de sair
    const meetEndObserver = new MutationObserver((_mutations) => {
      const endButton = findMeetEndButton();
      if (endButton) {
        endButton.addEventListener("click", () => {
          console.log("Botão de sair da reunião clicado");
          setTimeout(handleMeetEnd, 2000);
        });
      }
    });

    // Observa o documento inteiro para encontrar o botão quando ele aparecer
    meetEndObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Verifica imediatamente
    const endButton = findMeetEndButton();
    if (endButton) {
      endButton.addEventListener("click", () => {
        console.log("Botão de sair da reunião clicado (inicial)");
        setTimeout(handleMeetEnd, 2000);
      });
    }

    return meetEndObserver;
  }

  // Função para criar e mostrar um modal de confirmação para salvar
  function showSaveConfirmationModal(captionsText, fromTabClose = false) {
    // Remover modal existente se houver
    const existingModal = document.getElementById("captionSaverModal");
    if (existingModal) {
      document.body.removeChild(existingModal);
    }

    // Criar elementos do modal
    const modalOverlay = document.createElement("div");
    modalOverlay.id = "captionSaverModal";
    modalOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 9999;
    `;

    const modalContent = document.createElement("div");
    modalContent.style.cssText = `
      background-color: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
      max-width: 400px;
      text-align: center;
      font-family: Arial, sans-serif;
    `;

    const title = document.createElement("h3");
    title.textContent = "Salvar Legendas da Reunião";
    title.style.cssText = `margin-top: 0; color: #1a73e8;`;

    const message = document.createElement("p");
    if (fromTabClose) {
      message.textContent = `Você está saindo da página. Deseja salvar as ${finalTranscript.length} legendas capturadas?`;
    } else {
      message.textContent = `A reunião terminou. Deseja salvar as ${finalTranscript.length} legendas capturadas?`;
    }

    const buttonsContainer = document.createElement("div");
    buttonsContainer.style.cssText = `
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-top: 20px;
    `;

    const saveButton = document.createElement("button");
    saveButton.textContent = "Salvar";
    saveButton.style.cssText = `
      padding: 8px 16px;
      background-color: #1a73e8;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
    `;

    const cancelButton = document.createElement("button");
    cancelButton.textContent = "Cancelar";
    cancelButton.style.cssText = `
      padding: 8px 16px;
      background-color: #f1f1f1;
      color: #333;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    `;

    // Adicionar eventos
    saveButton.addEventListener("click", () => {
      console.log("Botão Salvar clicado no modal");

      // Adiciona feedback visual de que o download está sendo iniciado
      saveButton.textContent = "Iniciando download...";
      saveButton.disabled = true;
      saveButton.style.backgroundColor = "#cccccc";

      try {
        // Método direto: criar um link de download e clicar nele
        console.log("Tentando método direto de download");
        const blob = new Blob([captionsText], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `google-meet-captions-${timestamp}.txt`;

        // Criar elemento de link
        const downloadLink = document.createElement("a");
        downloadLink.href = url;
        downloadLink.download = filename;
        downloadLink.style.display = "none";
        document.body.appendChild(downloadLink);

        // Simular clique para iniciar o download
        downloadLink.click();

        // Limpar
        setTimeout(() => {
          document.body.removeChild(downloadLink);
          URL.revokeObjectURL(url);
        }, 100);

        console.log("Download iniciado via método direto");
        saveButton.textContent = "Download iniciado!";
        saveButton.style.backgroundColor = "#34a853";

        // Fecha o modal após um breve momento
        setTimeout(() => {
          if (document.body.contains(modalOverlay)) {
            document.body.removeChild(modalOverlay);
          }
        }, 1000);

        // Também salvar no histórico
        const meetingTitle =
          document.querySelector(".u6vdEc")?.textContent || "Google Meet";
        const meetingEndTimestamp = new Date().toISOString();

        chrome.runtime.sendMessage({
          action: "meeting_ended",
          meetingTitle: meetingTitle,
          meetingStartTimestamp: meetingStartTimestamp,
          meetingEndTimestamp: meetingEndTimestamp,
          transcript: transcript,
        });
      } catch (error) {
        console.error("Erro no método direto de download:", error);

        // Método alternativo: usar o background script
        console.log("Tentando método alternativo via background script");
        chrome.runtime.sendMessage(
          {
            action: "saveFile",
            content: captionsText,
            saveAs: true,
            fromTabClose: fromTabClose,
          },
          (response) => {
            console.log("Resposta do background script:", response);

            if (response && response.status === "success") {
              saveButton.textContent = "Download iniciado!";
              saveButton.style.backgroundColor = "#34a853";

              // Fecha o modal após um breve momento
              setTimeout(() => {
                if (document.body.contains(modalOverlay)) {
                  document.body.removeChild(modalOverlay);
                }
              }, 1000);
            } else {
              // Mostra mensagem de erro
              saveButton.textContent = "Erro ao salvar";
              saveButton.style.backgroundColor = "#e53935";

              // Adiciona mensagem de erro ao modal
              const errorMsg = document.createElement("p");
              errorMsg.textContent =
                response?.message || "Falha ao iniciar o download";
              errorMsg.style.color = "#e53935";
              modalContent.appendChild(errorMsg);

              // Reativa o botão após 2 segundos
              setTimeout(() => {
                saveButton.textContent = "Tentar novamente";
                saveButton.disabled = false;
                saveButton.style.backgroundColor = "#1a73e8";
              }, 2000);
            }
          }
        );
      }
    });

    cancelButton.addEventListener("click", () => {
      if (document.body.contains(modalOverlay)) {
        document.body.removeChild(modalOverlay);
      }
    });

    // Construir o modal
    buttonsContainer.appendChild(saveButton);
    buttonsContainer.appendChild(cancelButton);

    modalContent.appendChild(title);
    modalContent.appendChild(message);
    modalContent.appendChild(buttonsContainer);
    modalOverlay.appendChild(modalContent);

    // Adicionar ao corpo do documento
    document.body.appendChild(modalOverlay);

    console.log(
      "Modal de confirmação exibido",
      fromTabClose ? "(fechamento de aba)" : ""
    );
  }

  // Função para salvar as legendas
  function saveCaptions(captionsText, askToSave = false, fromTabClose = false) {
    console.log("Salvando legendas:", {
      tamanho: captionsText.length,
      askToSave: askToSave,
      fromTabClose: fromTabClose,
    });

    // Verificar se há conteúdo para salvar
    if (!captionsText || captionsText.length === 0) {
      console.error("Erro: Tentativa de salvar legendas vazias");
      if (!fromTabClose) {
        alert(
          "Não há legendas para salvar. Capture algumas legendas primeiro."
        );
      }
      return;
    }

    // Se for para perguntar ao usuário ou se for do fechamento da aba, mostra o modal
    if (askToSave || fromTabClose) {
      showSaveConfirmationModal(captionsText, fromTabClose);
      return;
    }

    // Caso contrário, tenta fazer o download diretamente
    try {
      console.log("Tentando download direto");

      // Método direto: criar um link de download e clicar nele
      const blob = new Blob([captionsText], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `google-meet-captions-${timestamp}.txt`;

      // Criar elemento de link
      const downloadLink = document.createElement("a");
      downloadLink.href = url;
      downloadLink.download = filename;
      downloadLink.style.display = "none";
      document.body.appendChild(downloadLink);

      // Simular clique para iniciar o download
      downloadLink.click();

      // Limpar
      setTimeout(() => {
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(url);
      }, 100);

      console.log("Download iniciado via método direto");
    } catch (error) {
      console.error("Erro no método direto de download:", error);
    }

    // Também salvar no histórico via background script (independente do método direto)
    console.log("Enviando solicitação para salvar no histórico");

    // Criar um objeto de reunião para salvar no histórico
    const meetingTitle =
      document.querySelector(".u6vdEc")?.textContent || "Google Meet";
    const meetingEndTimestamp = new Date().toISOString();

    // Enviar para o background script
    chrome.runtime.sendMessage(
      {
        action: "meeting_ended",
        meetingTitle: meetingTitle,
        meetingStartTimestamp: meetingStartTimestamp,
        meetingEndTimestamp: meetingEndTimestamp,
        transcript: transcript,
      },
      (response) => {
        console.log("Resposta do salvamento via meeting_ended:", response);

        if (response && response.status === "success") {
          console.log("Legendas salvas com sucesso no histórico");
        } else {
          console.error(
            "Erro ao salvar no histórico, tentando método alternativo"
          );

          // Tentar o método alternativo via background script
          chrome.runtime.sendMessage(
            {
              action: "saveFile",
              content: captionsText,
              saveAs: true, // Mostrar diálogo para escolher o local
              fromTabClose: false,
            },
            (altResponse) => {
              console.log("Resposta do salvamento alternativo:", altResponse);

              // Se houver erro, podemos mostrar um alerta
              if (altResponse && altResponse.status === "error") {
                console.error("Erro no método alternativo:", altResponse.error);
                alert(
                  `Erro ao salvar legendas: ${
                    altResponse.message || "Falha no download"
                  }`
                );
              }
            }
          );
        }
      }
    );
  }

  // Função para inicializar o modo automático
  function initializeAutoMode() {
    console.log("Inicializando modo automático");

    // Verificar se as legendas já estão ativas
    const captionsContainer = document.querySelector(
      'div[role="region"][tabindex="0"], .a4cQT, .Mz6pEf, .a4rNyd, .VbkSUe, div[aria-live="polite"], div[jsname][data-message-text], div[jscontroller][jsaction*="captions"]'
    );

    if (captionsContainer) {
      console.log("Legendas já estão ativas, iniciando captura diretamente");
      startCapturingWithLegendas();
      return;
    }

    // Primeiro tentar ativar legendas com a função fornecida pelo usuário
    console.log("Tentando ativar legendas com função ativarLegendas...");
    const legendasAtivadas = ativarLegendas();

    if (legendasAtivadas) {
      console.log("Legendas ativadas com sucesso usando ativarLegendas");
      // Iniciar captura após um breve intervalo
      setTimeout(() => {
        startCapturingWithLegendas();
      }, 2000);
    } else {
      // Se não conseguiu, tentar com enableCaptions como fallback
      console.log("Tentando método alternativo para ativar legendas...");
      enableCaptions().then((captionsEnabled) => {
        console.log("Resultado da ativação alternativa de legendas:", captionsEnabled);

        // Iniciar captura após um breve intervalo, mesmo se não conseguiu ativar as legendas
        // (a função startCapturing tentará ativar as legendas novamente se necessário)
        setTimeout(() => {
          startCapturingWithLegendas();
        }, 2000);
      });
    }

    // Tentar ativar legendas novamente após um intervalo maior
    setTimeout(() => {
      if (!isLegendaAtiva()) {
        console.log("Legendas ainda não ativas, tentando novamente...");
        ativarLegendas();
      }
    }, 5000);
  }

  // Função auxiliar para iniciar a captura e atualizar o status
  function startCapturingWithLegendas() {
    const success = startCapturing();
    console.log("Captura automática iniciada:", success);

    if (success) {
      // Notifica o popup que a captura foi iniciada
      chrome.runtime.sendMessage({
        action: "updateCaptureStatus",
        isCapturing: true,
      });

      // Atualiza o estado na storage
      chrome.storage.local.set({ isCapturing: true });
    } else {
      console.log(
        "Falha ao iniciar captura, verificando se as legendas estão ativas..."
      );

      // Verifica se as legendas estão ativas
      const captionsContainer = document.querySelector(
        'div[role="region"][tabindex="0"], .a4cQT, .Mz6pEf, .a4rNyd, .VbkSUe'
      );

      if (!captionsContainer) {
        console.log("Legendas não estão ativas, tentando ativar novamente...");
        // Tenta ativar as legendas uma última vez
        enableCaptions().then(() => {
          setTimeout(() => {
            const retrySuccess = startCapturing();
            console.log(
              "Última tentativa de captura automática:",
              retrySuccess
            );

            if (retrySuccess) {
              chrome.runtime.sendMessage({
                action: "updateCaptureStatus",
                isCapturing: true,
              });

              // Atualiza o estado na storage
              chrome.storage.local.set({ isCapturing: true });
            }
          }, 1000);
        });
      }
    }
  }

  function updateStatusIndicator(isActive) {
    // Remover indicador existente, se houver
    const existingIndicator = document.getElementById(
      "caption-saver-indicator"
    );
    if (existingIndicator) {
      existingIndicator.remove();
    }

    if (isActive) {
      const indicator = document.createElement("div");
      indicator.id = "caption-saver-indicator";
      indicator.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background-color: #1a73e8;
      z-index: 10000;
      opacity: 0.7;
      transition: opacity 0.5s ease;
    `;

      document.body.appendChild(indicator);

      // Piscar a cada 30 segundos para mostrar que está ativo
      setInterval(() => {
        indicator.style.opacity = "0.2";
        setTimeout(() => {
          indicator.style.opacity = "0.7";
        }, 1000);
      }, 30000);
    }
  }

  // Verifica as configurações e inicia o modo automático se necessário
  function checkAutoModeSettings() {
    chrome.storage.local.get(
      ["operationMode", "autoSave", "isCapturing"],
      (result) => {
        autoMode = result.operationMode === "auto";
        autoSave = result.autoSave || false;

        console.log("Verificando configurações de modo automático:", {
          operationMode: result.operationMode,
          autoMode,
          autoSave,
          isCapturing: result.isCapturing,
          url: window.location.href,
        });

        // Se estiver na reunião real do Google Meet e o modo automático estiver ativado, inicializa
        if (autoMode && isInActualMeeting()) {
          console.log(
            "Detectou reunião real do Google Meet com modo automático ativado"
          );

          // Verifica se já está capturando
          if (!result.isCapturing) {
            // Definimos um atraso para garantir que a página esteja completamente carregada
            setTimeout(() => {
              initializeAutoMode();
            }, 5000); // Espera 5 segundos para a interface estar pronta
          }
        }
      }
    );
  }

  function isLegendaAtiva() {
    const possibleSelectors = [
      // Seletores principais
      'div[role="region"][tabindex="0"]',
      'div[aria-live="polite"]',
      'div[jsname][data-message-text]',
      'div[jscontroller][jsaction*="captions"]',

      // Seletores de classes específicas
      ".a4cQT",
      ".Mz6pEf",
      ".a4rNyd",
      ".VbkSUe",
      ".ZPyPXe",

      // Seletores para legendas com aria-label
      'div[aria-label="Captions"]',
      'div[aria-label="Legendas"]',

      // Seletores mais genéricos
      "div.Jllm9e > div > div:nth-child(2)",
      'div[class*="caption"], div[class*="legenda"]',
    ];

    for (const selector of possibleSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element && element.offsetParent !== null) { // Verificar se está visível
          console.log(`Encontrado contêiner de legendas com seletor: ${selector}`);
          return true;
        }
      } catch (error) {
        console.warn(`Erro ao verificar seletor ${selector}:`, error);
      }
    }

    // Verificação adicional para botões de legendas que indicam que estão ativas
    const captionButtons = document.querySelectorAll('button[aria-label*="Turn off captions" i], button[aria-label*="Desativar legendas" i]');
    if (captionButtons.length > 0) {
      for (const button of captionButtons) {
        if (button.offsetParent !== null) { // Verificar se está visível
          console.log("Encontrado botão de desativar legendas, indicando que as legendas estão ativas");
          return true;
        }
      }
    }

    return false;
  }

  // Função saveCurrentMeetingToHistory removida - não estava sendo utilizada

  // Função removida: findSpeakerName não estava sendo utilizada

  // Função para verificar se estamos na reunião real (não na tela de configuração)
  function isInActualMeeting() {
    // Verificar se estamos na URL de uma reunião
    if (!window.location.href.includes("meet.google.com") ||
        !window.location.href.match(/\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?|$)/)) {
      return false;
    }

    // Verificar PRIMEIRO se o botão "call_end" (desligar) está visível
    // Este é o indicador mais confiável de que a reunião está em andamento

    // Método 1: Procurar pelo ícone call_end
    const callEndIcons = document.querySelectorAll('button i.google-symbols, button i.quRWN-Bz112c');
    let hasCallEndButton = false;

    for (const icon of callEndIcons) {
      if (icon.textContent.includes('call_end') && icon.offsetParent !== null) {
        console.log("Detectou botão 'call_end' (desligar chamada) pelo ícone - reunião em andamento");
        hasCallEndButton = true;
        break;
      }
    }

    // Método 2: Procurar pelo botão com aria-label "Leave call"
    if (!hasCallEndButton) {
      const leaveCallButtons = document.querySelectorAll('button[aria-label*="Leave call" i], button[aria-label*="Sair" i], button[aria-label*="Desligar" i]');
      for (const button of leaveCallButtons) {
        if (button.offsetParent !== null) {
          console.log("Detectou botão 'call_end' pelo aria-label - reunião em andamento");
          hasCallEndButton = true;
          break;
        }
      }
    }

    // Se não encontrou o botão call_end, verificar outros elementos
    if (!hasCallEndButton) {
      // Verificar se a interface da reunião está carregada (não apenas a tela de configuração)
      // Elementos que só aparecem quando a reunião está realmente em andamento
      const meetingElements = [
        // Barra inferior com controles da reunião
        '.NzPR9b',
        // Container principal da reunião
        '.R3Gmyc',
        // Botão de desligar/sair da reunião (usando aria-label)
        'button[aria-label*="Leave" i], button[aria-label*="Sair" i], button[aria-label*="Desligar" i], button[aria-label*="Hang up" i]',
        // Área de participantes
        '.WUFI9b',
        // Área de chat
        '.z38b6'
      ];

      // Se pelo menos um desses elementos estiver presente, estamos na reunião real
      for (const selector of meetingElements) {
        const element = document.querySelector(selector);
        if (element && element.offsetParent !== null) {
          console.log(`Detectou reunião real através do elemento: ${selector}`);
          return true;
        }
      }

      console.log("Ainda na tela de configuração, não na reunião real");
      return false;
    }

    return true;
  }

  // Função para ativar legendas fornecida pelo usuário
  function ativarLegendas() {
    console.log("Iniciando tentativa de ativar legendas...");

    // Lista de seletores para o botão de legendas (tanto para ativar quanto desativar)
    const seletoresBotaoLegendas = [
      // Botão moderno de legendas (com aria-label)
      'button[aria-label*="Turn on captions" i], button[aria-label*="Ativar legendas" i], button[aria-label*="Turn off captions" i], button[aria-label*="Desativar legendas" i]',

      // Botão com nome específico
      'button[jsname="r8qRAd"]',

      // Botão com tooltip
      'button[data-tooltip-id*="ucc"]',

      // Abordagem genérica
      '.VYBDae-Bz112c-LgbsSe, .VfPpkd-Bz112c-LgbsSe, .hk9qKe'
    ];

    // Função para verificar se um botão é o de legendas
    function isCaptionButton(button) {
      // Se não for um botão ou não estiver visível, ignorar
      if (!button || !button.offsetParent) return false;

      // Verificar atributos
      const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
      if (ariaLabel.includes('caption') || ariaLabel.includes('legenda')) {
        return true;
      }

      // Verificar se tem ícone de legenda
      const icons = button.querySelectorAll('i.google-symbols, i.quRWN-Bz112c');
      for (let i = 0; i < icons.length; i++) {
        if (icons[i].textContent.includes('closed_caption')) {
          return true;
        }
      }

      // Verificar data-tooltip
      const tooltip = (button.getAttribute('data-tooltip') || '').toLowerCase();
      if (tooltip.includes('caption') || tooltip.includes('legenda')) {
        return true;
      }

      return false;
    }

    // Procurar o botão de legendas usando os seletores
    let captionButton = null;
    for (const seletor of seletoresBotaoLegendas) {
      try {
        const elementos = document.querySelectorAll(seletor);
        for (const elemento of elementos) {
          if (isCaptionButton(elemento)) {
            captionButton = elemento;
            break;
          }
        }
        if (captionButton) break;
      } catch (erro) {
        console.warn(`Erro ao usar seletor ${seletor}:`, erro);
      }
    }

    // Se não encontrou com os seletores, procura todos os botões e verifica cada um
    if (!captionButton) {
      console.log("Não encontrou com seletores específicos, verificando todos os botões...");
      const allButtons = document.querySelectorAll('button');
      for (const button of allButtons) {
        if (isCaptionButton(button)) {
          captionButton = button;
          break;
        }
      }
    }

    // Se encontrou o botão, clica nele
    if (captionButton) {
      console.log("Botão de legendas encontrado:", captionButton);

      // Verificar se as legendas já estão ativas
      const ariaLabel = (captionButton.getAttribute('aria-label') || '').toLowerCase();
      const legendasAtivas = ariaLabel.includes('turn off') || ariaLabel.includes('desativar');

      if (legendasAtivas) {
        console.log("As legendas já estão ativas!");
        return true;
      }

      // Clicar no botão
      captionButton.click();
      console.log("Clique no botão de legendas executado");

      // Verificar se as legendas apareceram
      setTimeout(() => {
        const containerLegendas = document.querySelector('div[role="region"][tabindex="0"], div[aria-label="Captions"], .ZPyPXe');
        if (containerLegendas) {
          console.log("Legendas ativadas com sucesso!");
        } else {
          console.log("Não foi possível confirmar se as legendas foram ativadas. Verifique manualmente.");
        }
      }, 2000);

      return true;
    } else {
      // Tentar pelo botão de três pontos
      console.log("Tentando pelo menu de três pontos...");

      const moreOptionsButton = document.querySelector('button[aria-label*="mais" i], button[aria-label*="more" i], button[data-tooltip*="Mais"]');
      if (moreOptionsButton) {
        console.log("Botão de mais opções encontrado, clicando...");
        moreOptionsButton.click();

        // Esperar o menu abrir
        setTimeout(() => {
          const menuItems = document.querySelectorAll('div[role="menuitem"], span[role="menuitem"]');
          for (const item of menuItems) {
            const itemText = item.textContent.toLowerCase();
            if (itemText.includes("legenda") || itemText.includes("caption")) {
              console.log("Opção de legendas encontrada no menu, clicando...");
              item.click();
              return true;
            }
          }
          console.log("Não encontrou opção de legendas no menu");
          return false;
        }, 500);

        return true;
      }

      console.log("Não foi possível encontrar o botão de legendas");
      return false;
    }
  }

  // Função para ativar legendas imediatamente
  function ativarLegendasImediatamente() {
    console.log("Tentando ativar legendas imediatamente...");

    // Verificar se o botão "call_end" está visível (reunião em andamento)
    const callEndIcons = document.querySelectorAll('button i.google-symbols, button i.quRWN-Bz112c');
    let hasCallEndButton = false;

    for (const icon of callEndIcons) {
      if (icon.textContent.includes('call_end') && icon.offsetParent !== null) {
        hasCallEndButton = true;
        break;
      }
    }

    if (!hasCallEndButton) {
      console.log("Botão 'call_end' não encontrado - aguardando reunião iniciar...");
      return false;
    }

    // Usar a função ativarLegendas fornecida pelo usuário
    return ativarLegendas();
  }

  // Verificar configurações ao carregar a página
  checkAutoModeSettings();

  // Também verifica quando ocorrem mudanças na URL (navegação dentro do Google Meet)
  window.addEventListener("popstate", () => {
    console.log("URL mudou:", window.location.href);
    checkAutoModeSettings();

    // Tentar ativar legendas imediatamente após mudança de URL
    setTimeout(ativarLegendasImediatamente, 2000);
  });

  // E quando a página estiver totalmente carregada
  window.addEventListener("load", () => {
    console.log("Página carregada:", window.location.href);

    // Tentar ativar legendas imediatamente
    setTimeout(ativarLegendasImediatamente, 2000);

    // Inicializar para a reunião apenas se estiver na reunião real
    if (isInActualMeeting()) {
      console.log("Reunião real detectada, inicializando...");
      initializeForMeeting();
    } else {
      console.log("Não estamos na reunião real ainda, aguardando...");
    }

    setTimeout(checkAutoModeSettings, 2000);
  });

  // Verificar periodicamente se estamos em uma reunião e tentar ativar legendas
  setInterval(() => {
    if (isInActualMeeting()) {
      ativarLegendasImediatamente();
    }
  }, 5000);

  // Verifica periodicamente se estamos em uma reunião e o modo automático está ativado
  setInterval(() => {
    // Verificar se estamos na reunião real, não apenas na tela de configuração
    if (isInActualMeeting()) {
      // Verificar se as legendas estão ativas usando seletores mais robustos
      const captionsContainer = document.querySelector(
        'div[role="region"][tabindex="0"], div[aria-live="polite"], div[jsname][data-message-text], div[jscontroller][jsaction*="captions"]'
      );

      // Se estamos em modo automático e não estamos capturando, iniciar captura
      if (autoMode && !isCapturing) {
        console.log(
          "Verificação periódica: em reunião com modo automático, mas sem captura"
        );
        initializeAutoMode();
      }
      // Se as legendas estão ativas mas não estamos capturando, iniciar captura
      else if (captionsContainer && !isCapturing) {
        console.log("Verificação periódica: legendas ativas, mas sem captura");
        startCapturing();
      }
    }
  }, 15000); // Verifica a cada 15 segundos

  // Listener para mensagens do popup
  try {
    chrome.runtime.onMessage.addListener(function (
      request,
      _sender, // O parâmetro sender não é usado, mas é fornecido pelo Chrome API
      sendResponse
    ) {
    console.log("Recebida mensagem do popup:", request.action);

    if (request.action === "getStatus") {
      sendResponse({
        isCapturing: isCapturing,
        captionCount: finalTranscript.length || transcript.length,
      });
    } else if (request.action === "startCapture") {
      console.log("Iniciando captura a partir do popup");

      // Primeiro ativar as legendas e depois iniciar a captura
      enableCaptions().then((captionsEnabled) => {
        console.log("Legendas ativadas:", captionsEnabled);

        setTimeout(() => {
          const result = startCapturing();
          console.log("Resultado da captura:", result);

          // Enviar resposta assíncrona
          sendResponse({
            status: result ? "started" : "failed",
            captionsEnabled: captionsEnabled,
          });
        }, 1000);
      });

      // Manter a conexão aberta para resposta assíncrona
      return true;
    } else if (request.action === "stopCapture") {
      console.log("Parando captura a partir do popup");

      const result = stopCapturing();
      console.log("Resultado da parada:", result);

      // Enviar resposta com os dados das legendas
      sendResponse({
        status: "stopped",
        captions: result.captions,
        error: result.error,
        captionCount: finalTranscript.length || transcript.length,
      });
    } else if (request.action === "getCaptionCount") {
      // Retorna a contagem atual de legendas capturadas
      const count = finalTranscript.length || transcript.length;
      console.log("Contagem de legendas:", count);
      sendResponse({ count: count });
    } else if (request.action === "enableCaptions") {
      // Tenta ativar as legendas
      console.log("Ativando legendas a partir do popup");
      enableCaptions().then((result) => {
        sendResponse({ status: result ? "success" : "failed" });
      });

      // Manter a conexão aberta para resposta assíncrona
      return true;
    } else if (request.action === "settingsChanged") {
      // Atualiza as configurações
      console.log("Configurações alteradas:", request);
      autoMode = request.operationMode === "auto";
      autoSave = request.autoSave;

      // Se o modo automático foi ativado e estamos em uma reunião, inicia a captura
      if (
        autoMode &&
        window.location.href.includes("meet.google.com") &&
        window.location.href.match(/\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?|$)/) &&
        !isCapturing
      ) {
        console.log("Iniciando modo automático após mudança de configuração");
        initializeAutoMode();
      }

      sendResponse({
        status: "updated",
        autoMode: autoMode,
        isCapturing: isCapturing,
      });
    }

    if (request.action === "ping") {
      console.log("Recebido ping, respondendo");
      sendResponse({ status: "alive" });
      return true;
    }

    if (request.action === "isLegendaAtiva") {
      const isActive = isLegendaAtiva();
      console.log("Verificação de legendas ativas:", isActive);
      sendResponse({ isActive: isActive });
      return true;
    }

    // Por padrão, mantém a conexão aberta para resposta assíncrona
    return true;
  });
  } catch (error) {
    console.error("Erro ao configurar listener de mensagens:", error);
  }
})();
