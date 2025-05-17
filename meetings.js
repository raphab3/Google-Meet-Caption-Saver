document.addEventListener("DOMContentLoaded", function () {
  const meetingsTable = document.getElementById("meetings-list");
  const backLink = document.getElementById("back-link");

  // Voltar para a página anterior
  backLink.addEventListener("click", function (e) {
    e.preventDefault();
    window.close();
  });

  // Carregar reuniões do armazenamento
  loadMeetings();

  // Recarregar reuniões quando a página se tornar visível
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      loadMeetings();
    }
  });

  // Função para carregar reuniões
  function loadMeetings() {
    chrome.storage.local.get(["meetings"], function (result) {
      // Limpar conteúdo existente
      meetingsTable.innerHTML = "";

      if (result.meetings && result.meetings.length > 0) {
        // Percorrer reuniões em ordem inversa (mais recentes primeiro)
        for (let i = result.meetings.length - 1; i >= 0; i--) {
          const meeting = result.meetings[i];
          const timestamp =
            new Date(meeting.meetingStartTimestamp).toLocaleDateString() +
            " " +
            new Date(meeting.meetingStartTimestamp).toLocaleTimeString();
          const duration = getDuration(
            meeting.meetingStartTimestamp,
            meeting.meetingEndTimestamp
          );

          const row = document.createElement("tr");
          row.innerHTML = `
            <td>${meeting.meetingTitle || "Reunião do Google Meet"}</td>
            <td>
              <span class="meeting-date">${new Date(
                meeting.meetingStartTimestamp
              ).toLocaleDateString()}</span><br>
              <span class="meeting-time">${new Date(
                meeting.meetingStartTimestamp
              ).toLocaleTimeString()}</span>
              <span class="meeting-duration">• ${duration}</span>
            </td>
            <td>${meeting.transcript.length} blocos</td>
            <td>
              <button class="download-button" data-index="${i}">
                Baixar
              </button>
            </td>
          `;

          meetingsTable.appendChild(row);

          // Adicionar event listener para o botão de download
          const downloadButton = row.querySelector(".download-button");
          downloadButton.addEventListener("click", function () {
            const index = parseInt(downloadButton.getAttribute("data-index"));
            chrome.runtime.sendMessage(
              {
                action: "download_transcript",
                index: index,
              },
              function (response) {
                if (!response.success) {
                  alert("Não foi possível baixar a transcrição");
                }
              }
            );
          });
        }
      } else {
        // Exibir estado vazio
        meetingsTable.innerHTML = `
          <tr>
            <td colspan="4" class="empty-state">
              Nenhuma reunião encontrada.<br>
              Suas próximas reuniões aparecerão aqui.
            </td>
          </tr>
        `;
      }
    });
  }

  // Formatar duração entre dois timestamps
  function getDuration(meetingStartTimestamp, meetingEndTimestamp) {
    const duration =
      new Date(meetingEndTimestamp).getTime() -
      new Date(meetingStartTimestamp).getTime();
    const durationMinutes = Math.round(duration / (1000 * 60));
    const durationHours = Math.floor(durationMinutes / 60);
    const remainingMinutes = durationMinutes % 60;
    return durationHours > 0
      ? `${durationHours}h ${remainingMinutes}m`
      : `${durationMinutes}m`;
  }
});
