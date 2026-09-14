import com.android.apksig.ApkSigner;
import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collections;

/** Signs an APK with v1+v2 schemes using a keystore (apksig library). */
public class SignApk {
  public static void main(String[] args) throws Exception {
    File in = new File(args[0]);
    File out = new File(args[1]);
    File ksFile = new File(args[2]);
    char[] storePass = args[3].toCharArray();
    String alias = args[4];
    char[] keyPass = args.length > 5 ? args[5].toCharArray() : storePass;

    KeyStore ks = KeyStore.getInstance("JKS");
    try (FileInputStream fis = new FileInputStream(ksFile)) {
      ks.load(fis, storePass);
    }
    PrivateKey key = (PrivateKey) ks.getKey(alias, keyPass);
    X509Certificate cert = (X509Certificate) ks.getCertificate(alias);
    ApkSigner.SignerConfig signer =
        new ApkSigner.SignerConfig.Builder("CERT", key, Collections.singletonList(cert)).build();
    ApkSigner apkSigner =
        new ApkSigner.Builder(Collections.singletonList(signer))
            .setInputApk(in)
            .setOutputApk(out)
            .setV1SigningEnabled(true)
            .setV2SigningEnabled(true)
            .build();
    apkSigner.sign();
    System.out.println("signed: " + out.getAbsolutePath());
  }
}