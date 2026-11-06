import { chooseAIMove } from './engine.js';
self.onmessage = ({ data }) => {
  try {
    const move = chooseAIMove(data.game, { level: data.level });
    self.postMessage({ id: data.id, move });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
