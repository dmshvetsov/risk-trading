import "./styles.css";

function submitHandler(event: SubmitEvent) {
  event.preventDefault();

  const form = event.currentTarget;

  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const container = form.closest(".newsletter-form-container");

  if (!(container instanceof HTMLElement)) {
    return;
  }

  const formInput = container.querySelector(".newsletter-form-input");
  const success = container.querySelector(".newsletter-success");
  const errorContainer = container.querySelector(".newsletter-error");
  const errorMessage = container.querySelector(".newsletter-error-message");
  const backButton = container.querySelector(".newsletter-back-button");
  const submitButton = container.querySelector(".newsletter-form-button");
  const loadingButton = container.querySelector(".newsletter-loading-button");

  if (
    !(formInput instanceof HTMLInputElement) ||
    !(success instanceof HTMLElement) ||
    !(errorContainer instanceof HTMLElement) ||
    !(errorMessage instanceof HTMLElement) ||
    !(backButton instanceof HTMLButtonElement) ||
    !(submitButton instanceof HTMLButtonElement) ||
    !(loadingButton instanceof HTMLButtonElement)
  ) {
    return;
  }

  const rateLimit = () => {
    errorContainer.style.display = "flex";
    errorMessage.innerText = "Too many signups, please try again in a little while";
    submitButton.style.display = "none";
    formInput.style.display = "none";
    backButton.style.display = "block";
  };

  const timestamp = Date.now();
  const previousTimestamp = localStorage.getItem("loops-form-timestamp");

  if (previousTimestamp && Number(previousTimestamp) + 60_000 > timestamp) {
    rateLimit();
    return;
  }

  localStorage.setItem("loops-form-timestamp", String(timestamp));

  submitButton.style.display = "none";
  loadingButton.style.display = "flex";

  const formBody = `userGroup=&mailingLists=&email=${encodeURIComponent(
    formInput.value,
  )}`;

  fetch(form.action, {
    method: "POST",
    body: formBody,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  })
    .then(async (response) => {
      if (response.ok) {
        success.style.display = "flex";
        form.reset();
        return;
      }

      const rawData: unknown = await response.json().catch(() => null);
      const data =
        rawData !== null &&
        typeof rawData === "object" &&
        "message" in rawData &&
        (typeof rawData.message === "string" || rawData.message === undefined)
          ? rawData
          : null;

      errorContainer.style.display = "flex";
      errorMessage.innerText = data?.message ?? response.statusText;
      localStorage.setItem("loops-form-timestamp", "");
    })
    .catch((error: unknown) => {
      if (error instanceof Error && error.message === "Failed to fetch") {
        rateLimit();
        return;
      }

      errorContainer.style.display = "flex";
      errorMessage.innerText =
        error instanceof Error
          ? error.message
          : "Oops! Something went wrong, please try again";
      localStorage.setItem("loops-form-timestamp", "");
    })
    .finally(() => {
      formInput.style.display = "none";
      loadingButton.style.display = "none";
      backButton.style.display = "block";
    });
}

function resetFormHandler(event: MouseEvent) {
  const button = event.currentTarget;

  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const container = button.closest(".newsletter-form-container");

  if (!(container instanceof HTMLElement)) {
    return;
  }

  const formInput = container.querySelector(".newsletter-form-input");
  const success = container.querySelector(".newsletter-success");
  const errorContainer = container.querySelector(".newsletter-error");
  const errorMessage = container.querySelector(".newsletter-error-message");
  const backButton = container.querySelector(".newsletter-back-button");
  const submitButton = container.querySelector(".newsletter-form-button");

  if (
    !(formInput instanceof HTMLInputElement) ||
    !(success instanceof HTMLElement) ||
    !(errorContainer instanceof HTMLElement) ||
    !(errorMessage instanceof HTMLElement) ||
    !(backButton instanceof HTMLButtonElement) ||
    !(submitButton instanceof HTMLButtonElement)
  ) {
    return;
  }

  success.style.display = "none";
  errorContainer.style.display = "none";
  errorMessage.innerText = "Oops! Something went wrong, please try again";
  backButton.style.display = "none";
  formInput.style.display = "flex";
  submitButton.style.display = "flex";
}

for (const container of document.querySelectorAll(".newsletter-form-container")) {
  if (!(container instanceof HTMLElement)) {
    continue;
  }

  if (container.classList.contains("newsletter-handlers-added")) {
    continue;
  }

  const form = container.querySelector(".newsletter-form");
  const backButton = container.querySelector(".newsletter-back-button");

  if (form instanceof HTMLFormElement) {
    form.addEventListener("submit", submitHandler);
  }

  if (backButton instanceof HTMLButtonElement) {
    backButton.addEventListener("click", resetFormHandler);
  }

  container.classList.add("newsletter-handlers-added");
}
