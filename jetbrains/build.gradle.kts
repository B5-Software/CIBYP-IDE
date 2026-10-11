plugins {
    java
    id("org.jetbrains.intellij.platform") version "2.19.0"
}
group = "org.b5software.cibyp"
version = "0.1.0-alpha.1"
repositories { mavenCentral(); intellijPlatform { defaultRepositories() } }
dependencies {
    intellijPlatform { intellijIdeaCommunity("2025.2.5"); testFramework(org.jetbrains.intellij.platform.gradle.TestFrameworkType.Platform) }
    implementation("org.commonmark:commonmark:0.24.0")
    implementation("org.commonmark:commonmark-ext-gfm-tables:0.24.0")
    testImplementation("org.junit.jupiter:junit-jupiter:5.13.4")
    testImplementation("junit:junit:4.13.2")
    testRuntimeOnly("org.junit.vintage:junit-vintage-engine:5.13.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }
intellijPlatform {
    pluginConfiguration {
        name = "Could I Be Your Partner"
        ideaVersion { sinceBuild = "252" }
        vendor { name = "B5-Software"; url = "https://github.com/B5-Software" }
    }
}
tasks.test { useJUnitPlatform() }
tasks.processResources {
    from("../licenses/commonmark-0.24.0.txt") {
        into("META-INF")
        rename { "THIRD-PARTY-NOTICES.txt" }
    }
}
