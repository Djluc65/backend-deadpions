const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function(file) {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
    } else {
      if (file.endsWith('.js')) {
        arrayOfFiles.push(path.join(dirPath, "/", file));
      }
    }
  });

  return arrayOfFiles;
}

const srcDir = path.resolve(__dirname, '../src');
console.log(`🔍 Vérification de syntaxe dans : ${srcDir}`);

try {
    const files = getAllFiles(srcDir);
    let errorCount = 0;

    files.forEach(file => {
        try {
            execSync(`node --check "${file}"`, { stdio: 'pipe' });
            // console.log(`✅ ${path.basename(file)}`);
        } catch (error) {
            console.error(`❌ Erreur de syntaxe dans ${file}`);
            console.error(error.message);
            errorCount++;
        }
    });

    if (errorCount === 0) {
        console.log(`\n✅ SUCCÈS : ${files.length} fichiers vérifiés. Aucune erreur de syntaxe.`);
    } else {
        console.error(`\n❌ ÉCHEC : ${errorCount} fichier(s) contiennent des erreurs.`);
        process.exit(1);
    }

} catch (err) {
    console.error('Erreur lors de la lecture des fichiers:', err);
}
