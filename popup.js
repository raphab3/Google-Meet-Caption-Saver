document.addEventListener("DOMContentLoaded", function () {
  const autoModeRadio = document.getElementById("auto-mode");
  const manualModeRadio = document.getElementById("manual-mode");
  const startButton = document.getElementById("start-button");
  const stopButton = document.getElementById("stop-button");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");

  // Carregar configurações
  chrome.storage.local.get(["operationMode", "isCapturing"], function (result) {
    // Configurar seleção de modo
    if (result.operationMode === "manual") {
      manualModeRadio.checked = true;
    } else {
      autoModeRadio.checked = true;
    }

    // Atualizar estado dos botões
    updateCaptureStatus(result.isCapturing);
  });

  chrome.runtime.sendMessage(
    { action: "ping_background" },
    function (response) {
      if (chrome.runtime.lastError) {
        console.error(
          "Background não está respondendo:",
          chrome.runtime.lastError
        );
        document.body.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #ea4335;">
          <h2>Erro de Conexão</h2>
          <p>A extensão não está respondendo corretamente. Por favor:</p>
          <ol style="text-align: left;">
            <li>Recarregue a página do Google Meet</li>
            <li>Reinicie a extensão (desativar e ativar)</li>
            <li>Se o problema persistir, reinstale a extensão</li>
          </ol>
        </div>
      `;
        return;
      }
    }
  );

  // Atualizar indicador de status e botões
  function updateCaptureStatus(isCapturing) {
    if (isCapturing) {
      statusDot.classList.remove("inactive");
      statusDot.classList.add("active");
      statusText.textContent = "Capturando legendas...";
      startButton.disabled = true;
      stopButton.disabled = false;
    } else {
      statusDot.classList.remove("active");
      statusDot.classList.add("inactive");
      statusText.textContent = "Captura inativa";
      startButton.disabled = false;
      stopButton.disabled = true;
    }
  }

  function showError(message) {
    const errorDiv = document.getElementById("error-message");
    const errorText = document.getElementById("error-text");

    errorText.textContent = message;
    errorDiv.style.display = "block";

    // Esconder após alguns segundos
    setTimeout(() => {
      errorDiv.style.display = "none";
    }, 5000);
  }

  function sendMessageToTab(tabId, message, callback) {
    try {
      chrome.tabs.sendMessage(tabId, message, function (response) {
        if (chrome.runtime.lastError) {
          console.log(
            "Erro ao enviar mensagem:",
            chrome.runtime.lastError.message
          );
          // Tratamento de erro adequado
          if (callback) callback(null);
          return;
        }
        if (callback) callback(response);
      });
    } catch (error) {
      console.error("Exceção ao enviar mensagem:", error);
      if (callback) callback(null);
    }
  }

  // Verificar status de captura ao abrir o popup
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0] && tabs[0].url && tabs[0].url.includes("meet.google.com")) {
      sendMessageToTab(
        tabs[0].id,
        { action: "getStatus" },
        function (response) {
          if (response) {
            updateCaptureStatus(response.isCapturing);
          } else {
            // Se não houver resposta, assumimos que não está capturando
            updateCaptureStatus(false);
            statusText.textContent = "Aguardando conexão...";
          }
        }
      );
    } else {
      statusText.textContent = "Abra uma reunião do Google Meet";
      startButton.disabled = true;
      stopButton.disabled = true;
    }
  });

  // Event listeners para os botões de rádio
  autoModeRadio.addEventListener("change", function () {
    if (autoModeRadio.checked) {
      chrome.storage.local.set({ operationMode: "auto" }, function () {
        console.log("Modo Automático ativado");

        // Notificar a página de conteúdo sobre a mudança
        chrome.tabs.query(
          { active: true, currentWindow: true },
          function (tabs) {
            if (tabs[0].url.includes("meet.google.com")) {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: "settingsChanged",
                operationMode: "auto",
              });
            }
          }
        );
      });
    }
  });

  manualModeRadio.addEventListener("change", function () {
    if (manualModeRadio.checked) {
      chrome.storage.local.set({ operationMode: "manual" }, function () {
        console.log("Modo Manual ativado");

        // Notificar a página de conteúdo sobre a mudança
        chrome.tabs.query(
          { active: true, currentWindow: true },
          function (tabs) {
            if (tabs[0].url.includes("meet.google.com")) {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: "settingsChanged",
                operationMode: "manual",
              });
            }
          }
        );
      });
    }
  });

  // Event listener para botão iniciar
  startButton.addEventListener("click", function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0] && tabs[0].url && tabs[0].url.includes("meet.google.com")) {
        // Desabilitar o botão enquanto processa
        startButton.disabled = true;
        startButton.textContent = "Iniciando...";
        statusText.textContent = "Verificando conexão...";

        // Primeiro verificar se o content script está respondendo
        sendMessageToTab(
          tabs[0].id,
          { action: "ping" },
          function (pingResponse) {
            if (!pingResponse) {
              statusText.textContent = "Falha na conexão";
              showError(
                "A extensão não conseguiu se conectar à página do Meet. Tente recarregar a página."
              );
              startButton.disabled = false;
              startButton.textContent = "Iniciar Captura";
              return;
            }

            statusText.textContent = "Ativando legendas...";

            // Tentar ativar as legendas primeiro
            sendMessageToTab(
              tabs[0].id,
              { action: "enableCaptions" },
              function (captionResponse) {
                setTimeout(() => {
                  sendMessageToTab(
                    tabs[0].id,
                    { action: "startCapture" },
                    function (response) {
                      if (response && response.status === "started") {
                        updateCaptureStatus(true);
                        statusText.textContent = "Capturando legendas...";
                      } else {
                        statusText.textContent =
                          response?.error || "Erro ao iniciar captura";
                        startButton.disabled = false;
                        startButton.textContent = "Iniciar Captura";
                      }
                    }
                  );
                }, 1500);
              }
            );
          }
        );
      }
    });
  });

  // Event listener para botão parar
  stopButton.addEventListener("click", function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0] && tabs[0].url && tabs[0].url.includes("meet.google.com")) {
        // Desabilitar o botão enquanto processa
        stopButton.disabled = true;
        stopButton.textContent = "Processando...";
        statusText.textContent = "Parando captura...";

        sendMessageToTab(
          tabs[0].id,
          { action: "stopCapture" },
          function (response) {
            if (response) {
              updateCaptureStatus(false);
              statusText.textContent = "Legendas salvas com sucesso!";

              // Resto do código para lidar com a resposta...
            } else {
              statusText.textContent = "Erro ao parar captura";
              stopButton.textContent = "Parar e Salvar";
              stopButton.disabled = false;
            }
          }
        );
      }
    });
  });
});
