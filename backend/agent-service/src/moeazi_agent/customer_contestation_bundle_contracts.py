from pydantic import Field,model_validator
from .customer_contestation_scope_contracts import Frozen
from .customer_contestation_canonical import digest
class ContestationBundleManifest(Frozen):
 scope_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); case_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); artifact_hashes:tuple[str,...]; request_hash:str=Field(pattern=r"^[a-f0-9]{64}$"); manifest_hash:str=Field(pattern=r"^[a-f0-9]{64}$")
 @model_validator(mode="after")
 def check(self):
  if not self.artifact_hashes or len(set(self.artifact_hashes))!=len(self.artifact_hashes) or self.manifest_hash!=digest(self.model_dump(exclude={"manifest_hash"},mode="python")): raise ValueError("bundle_manifest_invalid")
  return self
