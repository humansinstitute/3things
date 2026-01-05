import { closeAvatarMenu, updateAvatar } from "./avatar.js";
import { elements as el, hide, show } from "./dom.js";
import { onRefresh, state } from "./state.js";

export const initUI = () => {
  onRefresh(() => {
    updatePanels();
    void updateAvatar();
  });
  updatePanels();
  void updateAvatar();
};

const updatePanels = () => {
  if (state.session) {
    hide(el.loginPanel);
    show(el.sessionControls);
    show(el.journal);
  } else {
    show(el.loginPanel);
    hide(el.sessionControls);
    hide(el.journal);
    closeAvatarMenu();
  }
};

export const showError = (message) => {
  if (!el.errorTarget) return;
  el.errorTarget.textContent = message;
  el.errorTarget.removeAttribute("hidden");
};

export const clearError = () => {
  if (!el.errorTarget) return;
  el.errorTarget.textContent = "";
  el.errorTarget.setAttribute("hidden", "hidden");
};
