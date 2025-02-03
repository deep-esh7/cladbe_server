class FileExtensionType {
  static JPG = "jpg";
  static JPEG = "jpeg";
  static PNG = "png";
  static MP4 = "mp4";
  static AVI = "avi";
  static MOV = "mov";
  static MKV = "mkv";
  static MP3 = "mp3";
  static WAC = "wac";
  static AAC = "aac";
  static PDF = "pdf";

  static allTypes = [
    FileExtensionType.PDF,
    FileExtensionType.MP3,
    FileExtensionType.WAC,
    FileExtensionType.AAC,
    FileExtensionType.JPG,
    FileExtensionType.JPEG,
    FileExtensionType.PNG,
    FileExtensionType.MP4,
    FileExtensionType.AVI,
    FileExtensionType.MOV,
    FileExtensionType.MKV,
  ];

  static imageTypes = [
    FileExtensionType.JPG,
    FileExtensionType.JPEG,
    FileExtensionType.PNG,
  ];
  static videoTypes = [
    FileExtensionType.MP4,
    FileExtensionType.AVI,
    FileExtensionType.MOV,
    FileExtensionType.MKV,
  ];
  static audioTypes = [
    FileExtensionType.MP3,
    FileExtensionType.WAC,
    FileExtensionType.AAC,
  ];
  static pdfTypes = [FileExtensionType.PDF];

  static getContentType(fileExtension) {
    const ext = fileExtension.replaceAll(".", "").toLowerCase();
    if (FileExtensionType.imageTypes.includes(ext)) return "photo";
    if (FileExtensionType.videoTypes.includes(ext)) return "video";
    if (FileExtensionType.audioTypes.includes(ext)) return "audio";
    if (FileExtensionType.pdfTypes.includes(ext)) return "pdf";
    return "document";
  }
}

class AppDocument {
  constructor({
    name,
    documentPath,
    previewDocumentPath = null,
    bucketName = process.env.internalBucketName,
    bucketProvider,
    otherDetails = null,
    hashingCode,
    previewHashingCode = null,
    description = null,
    size = null,
  }) {
    this.name = name;
    this.documentPath = documentPath;
    this.previewDocumentPath = previewDocumentPath;
    this.bucketName = bucketName;
    this.bucketProvider = bucketProvider;
    this.otherDetails = otherDetails;
    this.hashingCode = hashingCode;
    this.previewHashingCode = previewHashingCode;
    this.description = description;
    this.size = size;
  }

  get getFileExtension() {
    return this.documentPath.split("/").pop().split(".").pop();
  }

  get getPreviewFileExtension() {
    return this.previewDocumentPath?.split("/").pop().split(".").pop();
  }

  copyWith({
    name,
    documentPath,
    previewDocumentPath,
    bucketName,
    bucketProvider,
    otherDetails,
    hashingCode,
    previewHashingCode,
    description,
    size,
  }) {
    return new AppDocument({
      name: name ?? this.name,
      documentPath: documentPath ?? this.documentPath,
      previewDocumentPath: previewDocumentPath ?? this.previewDocumentPath,
      bucketName: bucketName ?? this.bucketName,
      bucketProvider: bucketProvider ?? this.bucketProvider,
      otherDetails: otherDetails ?? this.otherDetails,
      hashingCode: hashingCode ?? this.hashingCode,
      previewHashingCode: previewHashingCode ?? this.previewHashingCode,
      description: description ?? this.description,
      size: size ?? this.size,
    });
  }

  toObject() {
    return {
      name: this.name,
      documentPath: this.documentPath,
      previewDocumentPath: this.previewDocumentPath,
      bucketName: this.bucketName,
      bucketProvider: this.bucketProvider,
      otherDetails: this.otherDetails,
      hashingCode: this.hashingCode,
      previewHashingCode: this.previewHashingCode,
      description: this.description,
      size: this.size,
    };
  }

  static fromObject(obj) {
    return new AppDocument(obj);
  }

  toString() {
    return `AppDocument(name: ${this.name}, documentPath: ${this.documentPath}, previewDocumentPath: ${this.previewDocumentPath}, bucketName: ${this.bucketName}, bucketProvider: ${this.bucketProvider}, otherDetails: ${this.otherDetails}, hashingCode: ${this.hashingCode}, previewHashingCode: ${this.previewHashingCode}, description: ${this.description}, size: ${this.size})`;
  }

  equals(other) {
    if (!(other instanceof AppDocument)) return false;
    if (this === other) return true;

    const mapEquals = (a, b) => {
      if (a === b) return true;
      if (!a || !b) return false;
      return JSON.stringify(a) === JSON.stringify(b);
    };

    return (
      this.name === other.name &&
      this.documentPath === other.documentPath &&
      this.previewDocumentPath === other.previewDocumentPath &&
      this.bucketName === other.bucketName &&
      this.bucketProvider === other.bucketProvider &&
      mapEquals(this.otherDetails, other.otherDetails) &&
      this.hashingCode === other.hashingCode &&
      this.previewHashingCode === other.previewHashingCode &&
      this.description === other.description &&
      this.size === other.size
    );
  }
}

module.exports = {
  FileExtensionType,
  AppDocument,
};
