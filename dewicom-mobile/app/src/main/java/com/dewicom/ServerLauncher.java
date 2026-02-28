package com.dewicom;

import android.content.Context;
import android.os.Environment;
import android.util.Log;
import java.io.BufferedReader;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;

public class ServerLauncher {
    private static final String TAG = "ServerLauncher";
    private Context context;
    private Process serverProcess;
    private boolean isServerRunning = false;

    public ServerLauncher(Context context) {
        this.context = context;
    }

    public boolean startServer() {
        if (isServerRunning) return true;

        try {
            Log.d(TAG, "Démarrage serveur local...");
            
            // Extrait les fichiers du serveur
            extractServerFiles();
            
            // Lance le serveur Node.js
            boolean launched = launchNodeServer();
            
            if (launched) {
                isServerRunning = true;
                Log.d(TAG, "Serveur démarré avec succès");
                return true;
            } else {
                Log.e(TAG, "Échec du démarrage du serveur");
                return false;
            }
            
        } catch (Exception e) {
            Log.e(TAG, "Erreur lors du démarrage du serveur", e);
            return false;
        }
    }

    private void extractServerFiles() throws IOException {
        File serverDir = new File(context.getFilesDir(), "server");
        if (!serverDir.exists()) {
            serverDir.mkdirs();
        }

        Log.d(TAG, "Extraction des fichiers du serveur vers: " + serverDir.getAbsolutePath());

        // Extrait package.json
        extractAsset("server/package.json", new File(serverDir, "package.json"));
        
        // Extrait le dossier server
        extractAssetDirectory("server/server", new File(serverDir, "server"));
        
        // Extrait le dossier public
        extractAssetDirectory("server/public", new File(serverDir, "public"));
        
        Log.d(TAG, "Fichiers extraits avec succès");
    }

    private void extractAsset(String assetPath, File destination) throws IOException {
        InputStream inputStream = context.getAssets().open(assetPath);
        OutputStream outputStream = new FileOutputStream(destination);

        byte[] buffer = new byte[1024];
        int length;
        while ((length = inputStream.read(buffer)) > 0) {
            outputStream.write(buffer, 0, length);
        }

        inputStream.close();
        outputStream.close();
        
        Log.d(TAG, "Extrait: " + assetPath + " -> " + destination.getAbsolutePath());
    }

    private void extractAssetDirectory(String assetDirPath, File destinationDir) throws IOException {
        if (!destinationDir.exists()) {
            destinationDir.mkdirs();
        }

        String[] files = context.getAssets().list(assetDirPath);
        if (files != null) {
            for (String file : files) {
                String assetPath = assetDirPath + "/" + file;
                File destinationFile = new File(destinationDir, file);

                try {
                    // Essaye de traiter comme un fichier
                    extractAsset(assetPath, destinationFile);
                } catch (IOException e) {
                    // Si ça échoue, c'est probablement un répertoire
                    extractAssetDirectory(assetPath, destinationFile);
                }
            }
        }
    }

    private boolean launchNodeServer() {
        try {
            File serverDir = new File(context.getFilesDir(), "server");
            Log.d(TAG, "Répertoire du serveur: " + serverDir.getAbsolutePath());
            
            // Vérifie si Node.js est disponible
            if (!isNodeAvailable()) {
                Log.e(TAG, "Node.js n'est pas disponible sur cet appareil");
                return false;
            }
            
            // Essaie d'installer les dépendances npm
            boolean npmInstalled = installNpmDependencies(serverDir);
            if (!npmInstalled) {
                Log.w(TAG, "Installation npm échouée, mais tentative de lancement quand même");
            }
            
            // Lance le serveur avec différentes approches
            return tryLaunchServer(serverDir);
            
        } catch (Exception e) {
            Log.e(TAG, "Erreur lors du lancement du serveur", e);
            return false;
        }
    }
    
    private boolean isNodeAvailable() {
        try {
            Process process = Runtime.getRuntime().exec("which node");
            process.waitFor();
            return process.exitValue() == 0;
        } catch (Exception e) {
            Log.w(TAG, "Node.js non trouvé via 'which node'");
            return false;
        }
    }
    
    private boolean installNpmDependencies(File serverDir) {
        try {
            Log.d(TAG, "Installation des dépendances npm...");
            
            ProcessBuilder pb = new ProcessBuilder("sh", "-c", "cd " + serverDir.getAbsolutePath() + " && npm install --production");
            pb.redirectErrorStream(true);
            Process process = pb.start();
            
            // Log la sortie de npm
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
            String line;
            while ((line = reader.readLine()) != null) {
                Log.d(TAG, "npm: " + line);
            }
            
            int exitCode = process.waitFor();
            Log.d(TAG, "npm install terminé avec code: " + exitCode);
            
            return exitCode == 0;
        } catch (Exception e) {
            Log.e(TAG, "Erreur lors de npm install", e);
            return false;
        }
    }
    
    private boolean tryLaunchServer(File serverDir) {
        // Essaie plusieurs approches pour lancer le serveur
        String[] approaches = {
            "cd " + serverDir.getAbsolutePath() + " && node server/index.js",
            "cd " + serverDir.getAbsolutePath() + " && nodejs server/index.js",
            "cd " + serverDir.getAbsolutePath() + " && /usr/bin/node server/index.js"
        };
        
        for (String approach : approaches) {
            try {
                Log.d(TAG, "Tentative de lancement: " + approach);
                
                ProcessBuilder pb = new ProcessBuilder("sh", "-c", approach);
                pb.redirectErrorStream(true);
                serverProcess = pb.start();
                
                // Attend un peu pour voir si le processus démarre
                Thread.sleep(2000);
                
                if (serverProcess.isAlive()) {
                    Log.d(TAG, "Serveur lancé avec succès avec: " + approach);
                    return true;
                } else {
                    Log.w(TAG, "Le processus s'est terminé rapidement avec: " + approach);
                    
                    // Log la sortie pour le débogage
                    BufferedReader reader = new BufferedReader(new InputStreamReader(serverProcess.getInputStream()));
                    String line;
                    while ((line = reader.readLine()) != null) {
                        Log.e(TAG, "Erreur serveur: " + line);
                    }
                }
                
            } catch (Exception e) {
                Log.e(TAG, "Erreur avec l'approche: " + approach, e);
            }
        }
        
        return false;
    }

    public void stopServer() {
        if (serverProcess != null) {
            serverProcess.destroy();
            serverProcess = null;
        }
        isServerRunning = false;
        Log.d(TAG, "Serveur arrêté");
    }

    public boolean isServerRunning() {
        return isServerRunning && (serverProcess == null || serverProcess.isAlive());
    }
}
