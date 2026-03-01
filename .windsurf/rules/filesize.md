---
trigger: always_on
---
Tout fichier dépassant 1000 lignes doit être modularisé si c'est techniquement possible:

- Identifier les blocs fonctionnels cohérents (ex: gestion socket, UI, audio, élection leader, etc.)
- Extraire chaque bloc dans un fichier dédié avec un nom explicite
- Utiliser des imports/exports appropriés au langage (ES modules, CommonJS `require`, Java classes séparées, etc.)
- Le fichier principal devient un orchestrateur léger qui importe les modules
- Documenter brièvement chaque module extrait (une ligne de commentaire en tête de fichier suffit)

Cette règle s'applique à tous les langages du projet : JavaScript, Java, HTML (scripts inline à externaliser), Gradle.
