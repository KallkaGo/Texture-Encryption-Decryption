import App from "./app";

window.addEventListener("DOMContentLoaded", () => {
  App.shared.initialize(document.querySelector(".glCanvas") as HTMLDivElement);
  App.shared.loadTexureImage("/textures/diffuse2.png");
});
