import './style.css';
import { buildApp } from './ui/app';

const root = document.getElementById('app')!;
const { scene, loading } = buildApp(root);

scene
  .load(`${import.meta.env.BASE_URL}heart/heart.glb`, `${import.meta.env.BASE_URL}heart/heart.json`)
  .then(() => loading.classList.add('gone'))
  .catch((err) => {
    loading.textContent = 'The heart model could not be loaded.';
    console.error(err);
  });
